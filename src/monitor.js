'use strict';

// Polls Ollama, Open WebUI and n8n and turns their APIs into a single snapshot.
// Plain Node (no Electron) so it can also run headless via src/cli.js.

const { EventEmitter } = require('node:events');
const { listModels } = require('./openwebui');

const TIMEOUT_MS = 4000;
const N8N_WORKFLOW_CACHE_MS = 60_000;
const N8N_RECENT_LIMIT = 100;
const OLLAMA_TAGS_CACHE_MS = 60_000;
const ACTIVITY_SHOWN = 25;
const DAY_MS = 86_400_000;
const N8N_RUN_TIMEOUT_MS = 120_000;

// The public API can't start a workflow, but its Webhook trigger can be called from outside.
function webhookOf(workflow) {
  const node = (workflow.nodes || []).find((n) => n.type === 'n8n-nodes-base.webhook' && !n.disabled);
  if (!node) return null;
  const p = node.parameters || {};
  return {
    method: (p.httpMethod || 'GET').toUpperCase(),
    path: String(p.path || node.webhookId || '').replace(/^\/+/, ''),
    auth: p.authentication || 'none',
  };
}

const trim = (url) => url.replace(/\/+$/, '');

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describeError(err) {
  if (err.name === 'TimeoutError') return 'timed out';
  // undici nests the socket error, sometimes inside an AggregateError (IPv4 + IPv6 attempts).
  const code = err.cause?.code || err.cause?.errors?.[0]?.code;
  if (code === 'ECONNREFUSED') return 'connection refused';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'host not found';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'host unreachable';
  return code || err.cause?.message || err.message;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function since(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

// Each checker gets its service config and the `data` it returned last poll
// (undefined on the first poll), and returns { state, summary, details, data, events }.
// state: 'up' | 'busy' | 'degraded'. Throwing means 'down'.

async function checkOllama(cfg, prev) {
  const base = trim(cfg.url);
  const { version } = await getJson(`${base}/api/version`);
  const ps = await getJson(`${base}/api/ps`);

  const models = (ps.models || []).map((m) => ({
    name: m.name,
    size: m.size,
    sizeVram: m.size_vram,
    expiresAt: m.expires_at,
  }));

  // Ollama has no "request in flight" endpoint. It does push a loaded model's
  // expires_at forward on every request, so a moved expiry means recent activity.
  const prevExpiry = new Map((prev?.models || []).map((m) => [m.name, m.expiresAt]));
  const active = [];
  const loaded = [];
  for (const m of models) {
    if (!prevExpiry.has(m.name)) loaded.push(m.name);
    else if (prevExpiry.get(m.name) !== m.expiresAt) active.push(m.name);
  }

  const events = prev
    ? loaded.map((name) => ({ kind: 'modelLoaded', title: 'Ollama', body: `Model loaded: ${name}` }))
    : [];
  const busyModels = prev ? [...new Set([...active, ...loaded])] : [];

  let summary;
  if (busyModels.length) summary = `${busyModels.join(', ')} working`;
  else if (models.length) summary = `${models.length} model${models.length > 1 ? 's' : ''} loaded`;
  else summary = 'idle';

  const details = models.map((m) => {
    const onGpu = m.size ? Math.round((m.sizeVram / m.size) * 100) : 0;
    return `${m.name} · ${formatBytes(m.size)} · ${onGpu}% GPU`;
  });
  details.push(`version ${version}`);

  let installed = prev?.installed || [];
  let tagsAt = prev?.tagsAt || 0;
  if (Date.now() - tagsAt > OLLAMA_TAGS_CACHE_MS) {
    try {
      const tags = await getJson(`${base}/api/tags`);
      installed = (tags.models || []).map((m) => ({
        name: m.name,
        size: m.size,
        params: m.details?.parameter_size,
        quant: m.details?.quantization_level,
      }));
      tagsAt = Date.now();
    } catch {
      // Keep the previous list; the next poll retries.
    }
  }

  return {
    state: busyModels.length ? 'busy' : 'up',
    summary,
    details,
    data: { models, installed, tagsAt },
    events,
  };
}

async function checkOpenWebUI(cfg) {
  const base = trim(cfg.url);
  const health = await getJson(`${base}/health`);
  if (health && health.status === false) throw new Error('health check failed');

  const details = [];
  try {
    const { version } = await getJson(`${base}/api/version`);
    if (version) details.push(`version ${version}`);
  } catch {
    // Older builds have no /api/version; health alone is enough.
  }

  if (!cfg.apiKey) return { state: 'up', summary: 'healthy', details, data: {}, events: [] };

  try {
    const models = await listModels(cfg, TIMEOUT_MS);
    const shown = models.slice(0, 4).map((m) => m.name);
    if (models.length > shown.length) shown.push(`+${models.length - shown.length} more`);
    details.unshift(...shown);
    return { state: 'up', summary: `${models.length} models available`, details, data: {}, events: [] };
  } catch (err) {
    const why = err.status === 401 || err.status === 403 ? 'API key rejected' : describeError(err);
    return { state: 'degraded', summary: why, details, data: {}, events: [] };
  }
}

async function checkN8n(cfg, prev) {
  const base = trim(cfg.url);
  await getJson(`${base}/healthz`);

  if (!cfg.apiKey) {
    return { state: 'up', summary: 'healthy (add apiKey for executions)', details: [], data: {}, events: [] };
  }

  const headers = { 'X-N8N-API-KEY': cfg.apiKey };
  const data = {
    workflowNames: prev?.workflowNames || {},
    workflows: prev?.workflows || [],
    workflowsFetchedAt: prev?.workflowsFetchedAt || 0,
    lastErrorId: prev?.lastErrorId,
  };

  let errors;
  try {
    if (Date.now() - data.workflowsFetchedAt > N8N_WORKFLOW_CACHE_MS) {
      const wf = await getJson(`${base}/api/v1/workflows?limit=250`, headers);
      data.workflowNames = Object.fromEntries((wf.data || []).map((w) => [w.id, w.name]));
      data.workflows = (wf.data || []).map((w) => ({ id: w.id, name: w.name, active: w.active, webhook: webhookOf(w) }));
      data.workflowsFetchedAt = Date.now();
    }
    errors = (await getJson(`${base}/api/v1/executions?status=error&limit=10`, headers)).data || [];
  } catch (err) {
    const why = err.status === 401 || err.status === 403 ? 'API key rejected' : describeError(err);
    return { state: 'degraded', summary: why, details: [], data, events: [] };
  }

  // status=running only exists on recent n8n versions; older ones answer 400.
  let running = null;
  try {
    running = (await getJson(`${base}/api/v1/executions?status=running&limit=50`, headers)).data || [];
  } catch {
    running = null;
  }

  const name = (e) => data.workflowNames[e.workflowId] || `workflow ${e.workflowId}`;

  // Latest runs of any status, for the activity feed and the 24h counters.
  try {
    const recent = (await getJson(`${base}/api/v1/executions?limit=${N8N_RECENT_LIMIT}`, headers)).data || [];
    data.recent = recent.map((e) => ({
      id: e.id,
      workflowId: e.workflowId,
      name: name(e),
      status: e.status,
      startedAt: e.startedAt,
      stoppedAt: e.stoppedAt,
    }));
  } catch {
    data.recent = prev?.recent || [];
  }
  const events = [];
  const newestErrorId = errors.reduce((max, e) => Math.max(max, Number(e.id)), 0);
  if (data.lastErrorId !== undefined) {
    for (const e of errors.filter((e) => Number(e.id) > data.lastErrorId).reverse()) {
      events.push({ kind: 'workflowFailed', title: 'n8n', body: `Workflow failed: ${name(e)}` });
    }
  }
  data.lastErrorId = Math.max(data.lastErrorId ?? 0, newestErrorId);

  const details = [];
  if (running) details.push(...running.map((e) => `▶ ${name(e)} · ${since(e.startedAt)}`));
  details.push(...errors.slice(0, 3).map((e) => `✕ ${name(e)} · ${since(e.stoppedAt || e.startedAt)} ago`));

  const count = running?.length || 0;
  const summary = count
    ? `${count} workflow${count > 1 ? 's' : ''} running`
    : `${Object.keys(data.workflowNames).length} workflows, none running`;

  return { state: count ? 'busy' : 'up', summary, details, data, events };
}

const SERVICES = [
  { id: 'ollama', name: 'Ollama', check: checkOllama, hasUi: false },
  { id: 'openwebui', name: 'Open WebUI', check: checkOpenWebUI, hasUi: true },
  { id: 'n8n', name: 'n8n', check: checkN8n, hasUi: true },
];

const SEVERITY = { down: 4, degraded: 3, busy: 2, up: 1 };

class Monitor extends EventEmitter {
  constructor(config) {
    super();
    this.setConfig(config);
  }

  setConfig(config) {
    this.config = config;
    this.results = {};
    this.failures = {};
    this.snapshot = this._buildSnapshot();
    if (this.timer) {
      this.stop();
      this.start();
    }
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.config.pollIntervalSeconds * 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.ticking) return this.snapshot;
    this.ticking = true;
    try {
      const enabled = SERVICES.filter((s) => this.config.services[s.id]?.enabled);
      const results = await Promise.all(enabled.map((s) => this._checkOne(s)));
      enabled.forEach((s, i) => {
        this._emitTransitions(s, this.results[s.id], results[i]);
        this.results[s.id] = results[i];
      });
      this.snapshot = this._buildSnapshot();
      this.emit('update', this.snapshot);
      return this.snapshot;
    } finally {
      this.ticking = false;
    }
  }

  async _checkOne(service) {
    const cfg = this.config.services[service.id];
    const prev = this.results[service.id];
    try {
      const result = await service.check(cfg, prev?.data);
      this.failures[service.id] = 0;
      return result;
    } catch (err) {
      // One blip (a dropped DNS answer, a slow request) shouldn't flash red and notify:
      // keep showing the last good result until enough checks fail in a row.
      const failures = (this.failures[service.id] || 0) + 1;
      this.failures[service.id] = failures;
      if (prev && prev.state !== 'down' && failures < this.config.downAfterFailures) {
        return { ...prev, events: [] };
      }
      // Keep the previous data so state tracking resumes cleanly once it's back.
      return { state: 'down', summary: describeError(err), details: [cfg.url], data: prev?.data, events: [] };
    }
  }

  _emitTransitions(service, prev, next) {
    if (prev) {
      if (prev.state !== 'down' && next.state === 'down') {
        this.emit('event', { service: service.id, kind: 'serviceDown', title: service.name, body: `Down: ${next.summary}` });
      } else if (prev.state === 'down' && next.state !== 'down') {
        this.emit('event', { service: service.id, kind: 'serviceUp', title: service.name, body: 'Back online' });
      }
    }
    for (const event of next.events) this.emit('event', { service: service.id, ...event });
  }

  _buildSnapshot() {
    const services = SERVICES.filter((s) => this.config.services[s.id]?.enabled).map((s) => {
      const r = this.results[s.id];
      return {
        id: s.id,
        name: s.name,
        state: r ? r.state : 'unknown',
        summary: r ? r.summary : 'checking…',
        details: r ? r.details : [],
        webUrl: s.hasUi ? this.config.services[s.id].url : null,
      };
    });
    const overall = services.reduce(
      (worst, s) => ((SEVERITY[s.state] || 0) > (SEVERITY[worst] || 0) ? s.state : worst),
      'unknown',
    );
    return { overall, updatedAt: new Date().toISOString(), services, launcher: this._buildLauncher(),
      activity: this._buildActivity(),
      models: this._buildModels(),
    };
  }

  _launchable(workflow) {
    const cfg = this.config.services.n8n;
    const hook = workflow.webhook;
    if (!workflow.active) return 'inactive';
    if (!hook.path || hook.path.includes(':')) return 'needs path parameters';
    if (hook.auth !== 'none' && !cfg.webhookHeaders?.[workflow.id]) return 'needs auth';
    return null;
  }

  // Why an n8n-backed panel can't show anything yet, or null when it can.
  _n8nBlocker(what) {
    const cfg = this.config.services.n8n;
    const result = this.results.n8n;
    if (!cfg?.enabled) return 'n8n is disabled in config.';
    if (!cfg.apiKey) return `Add the n8n API key in Settings to see ${what}.`;
    if (!result) return 'Loading…';
    if (result.state === 'down') return `n8n is down: ${result.summary}`;
    return null;
  }

  _buildActivity() {
    const blocker = this._n8nBlocker('activity');
    if (blocker) return { message: blocker, runs: [], ok24h: 0, failed24h: 0 };
    const recent = this.results.n8n.data?.recent || [];
    const dayAgo = Date.now() - DAY_MS;
    const lastDay = recent.filter((e) => new Date(e.startedAt).getTime() > dayAgo);
    return {
      message: recent.length ? null : 'No executions yet.',
      runs: recent.slice(0, ACTIVITY_SHOWN).map((e) => ({
        id: e.id,
        workflowId: e.workflowId,
        name: e.name,
        status: e.status,
        at: e.stoppedAt || e.startedAt,
        durationMs: e.stoppedAt ? new Date(e.stoppedAt) - new Date(e.startedAt) : null,
      })),
      ok24h: lastDay.filter((e) => e.status === 'success').length,
      failed24h: lastDay.filter((e) => e.status === 'error' || e.status === 'crashed').length,
    };
  }

  _buildModels() {
    const cfg = this.config.services.ollama;
    const result = this.results.ollama;
    const empty = { loaded: [], installed: [], vram: null, disk: null };
    if (!cfg?.enabled) return { message: 'Ollama is disabled in config.', ...empty };
    if (!result) return { message: 'Loading…', ...empty };
    if (result.state === 'down') return { message: `Ollama is down: ${result.summary}`, ...empty };

    const loaded = result.data?.models || [];
    const installed = result.data?.installed || [];
    const loadedNames = new Set(loaded.map((m) => m.name));
    return {
      message: null,
      loaded: loaded.map((m) => ({
        name: m.name,
        size: formatBytes(m.size),
        gpu: m.size ? Math.round((m.sizeVram / m.size) * 100) : 0,
        expiresAt: m.expiresAt,
      })),
      installed: installed
        .map((m) => ({ name: m.name, size: formatBytes(m.size), params: m.params, quant: m.quant, loaded: loadedNames.has(m.name) }))
        .sort((a, b) => b.loaded - a.loaded || a.name.localeCompare(b.name)),
      vram: formatBytes(loaded.reduce((sum, m) => sum + (m.sizeVram || 0), 0)),
      disk: formatBytes(installed.reduce((sum, m) => sum + (m.size || 0), 0)),
    };
  }

  _buildLauncher() {
    const blocker = this._n8nBlocker('workflows');
    if (blocker) return { message: blocker, workflows: [], others: 0 };
    const result = this.results.n8n;

    const all = result.data?.workflows || [];
    const recent = result.data?.recent || [];
    const withHook = all.filter((w) => w.webhook);
    const workflows = withHook
      .map((w) => {
        const reason = this._launchable(w);
        const last = recent.find((e) => e.workflowId === w.id);
        return {
          id: w.id,
          name: w.name,
          method: w.webhook.method,
          runnable: !reason,
          reason,
          lastRun: last ? { status: last.status, at: last.stoppedAt || last.startedAt } : null,
        };
      })
      .sort((a, b) => b.runnable - a.runnable || a.name.localeCompare(b.name));
    return { message: null, workflows, others: all.length - withHook.length };
  }

  // Calls a workflow's Webhook trigger. Resolves to { ok, message } and never throws.
  async runWorkflow(id) {
    const cfg = this.config.services.n8n;
    const workflow = (this.results.n8n?.data?.workflows || []).find((w) => w.id === id);
    if (!workflow?.webhook) return { ok: false, message: 'No webhook trigger' };
    const reason = this._launchable(workflow);
    if (reason) return { ok: false, message: reason };

    const { method, path } = workflow.webhook;
    const url = new URL(`${trim(cfg.url)}/webhook/${path}`);
    const init = {
      method,
      headers: { ...(cfg.webhookHeaders?.[id] || {}) },
      signal: AbortSignal.timeout(N8N_RUN_TIMEOUT_MS),
    };
    const payload = { source: 'ciouciou', triggeredAt: new Date().toISOString() };
    if (method === 'GET' || method === 'HEAD') {
      for (const [k, v] of Object.entries(payload)) url.searchParams.set(k, v);
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(payload);
    }

    try {
      const res = await fetch(url, init);
      const text = (await res.text()).trim();
      let message = text;
      try {
        message = JSON.parse(text).message || text;
      } catch {
        // Plain-text response.
      }
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}${message ? `: ${message}` : ''}`.slice(0, 140) };
      return { ok: true, message: (message || 'Started').slice(0, 140) };
    } catch (err) {
      return { ok: false, message: describeError(err) };
    } finally {
      this.tick();
    }
  }
}

module.exports = { Monitor, SERVICES, describeError };
