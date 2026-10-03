'use strict';

// Right-hand home card: start n8n workflows through their Webhook trigger.
// Shares `views` and `cheer` with island.js, `setPanelCount` with panels.js.

const wfList = document.getElementById('workflows');
const wfNote = document.getElementById('wf-note');

const ARM_MS = 3000; // How long "Confirm?" waits for the second click.
const RESULT_MS = 6000;

const wfViews = new Map(); // id -> row elements, kept across polls so clicks aren't lost
const wfPhase = new Map(); // id -> { phase: 'armed' | 'running' | 'done', ok, message, timer }
let wfData = new Map();
let wfBuiltFor = '';

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function buildRow(id) {
  const el = document.createElement('div');
  el.className = 'wf';
  el.innerHTML = `
    <div class="wf-main">
      <button class="wf-name" type="button"></button>
      <div class="wf-meta"><span class="run-dot"></span><span class="method"></span><span class="result"></span></div>
    </div>
    <button class="run" type="button"></button>`;
  const view = {
    el,
    name: el.querySelector('.wf-name'),
    dot: el.querySelector('.run-dot'),
    method: el.querySelector('.method'),
    result: el.querySelector('.result'),
    button: el.querySelector('.run'),
  };
  view.name.addEventListener('click', () => window.ciouciou.n8n.edit(id));
  view.button.addEventListener('click', () => onRunClick(id));
  return view;
}

function setPhase(id, phase) {
  clearTimeout(wfPhase.get(id)?.timer);
  if (phase) wfPhase.set(id, phase);
  else wfPhase.delete(id);
  paint(id);
}

// First click arms the button, a second click within ARM_MS actually starts the workflow.
async function onRunClick(id) {
  const current = wfPhase.get(id);
  if (!current) {
    setPhase(id, { phase: 'armed', timer: setTimeout(() => setPhase(id, null), ARM_MS) });
    return;
  }
  if (current.phase !== 'armed') return;

  setPhase(id, { phase: 'running' });
  const result = await window.ciouciou.n8n.run(id);
  const n8n = views.get('n8n');
  if (n8n && result.ok) {
    cheer(n8n.barChick);
    cheer(n8n.rowChick);
  }
  setPhase(id, { phase: 'done', ok: result.ok, message: result.message, timer: setTimeout(() => setPhase(id, null), RESULT_MS) });
}

function buttonLabel(w, p) {
  if (!w.runnable) return { 'needs auth': 'Locked', inactive: 'Inactive' }[w.reason] || 'Unavailable';
  if (!p) return 'Run';
  if (p.phase === 'armed') return 'Confirm?';
  if (p.phase === 'running') return 'Running…';
  return p.ok ? '✓ Started' : '✕ Failed';
}

function paint(id) {
  const v = wfViews.get(id);
  const w = wfData.get(id);
  if (!v || !w) return;
  const p = wfPhase.get(id);

  v.name.textContent = w.name;
  v.name.title = `${w.name}
Open in n8n`;
  v.method.textContent = w.method;
  v.dot.className = `run-dot ${w.lastRun?.status || ''}`;
  if (p?.phase === 'done') {
    v.result.textContent = p.message;
    v.result.className = `result ${p.ok ? 'ok' : 'err'}`;
  } else {
    v.result.className = 'result';
    if (!w.runnable) v.result.textContent = w.reason;
    else v.result.textContent = w.lastRun ? `${w.lastRun.status} · ${ago(w.lastRun.at)} ago` : 'never run';
  }

  const b = v.button;
  b.disabled = !w.runnable;
  b.textContent = buttonLabel(w, p);
  b.className = `run${p ? ` ${p.phase === 'done' ? (p.ok ? 'done-ok' : 'done-err') : p.phase}` : ''}`;
  b.title = w.runnable ? (p?.phase === 'done' ? p.message : `${w.method} webhook`) : `Can't start: ${w.reason}`;
}

function setNote(text, center = false) {
  wfNote.hidden = !text;
  wfNote.textContent = text || '';
  wfNote.classList.toggle('center', center);
}

function renderWorkflows(launcher) {
  if (!launcher) return;
  wfData = new Map(launcher.workflows.map((w) => [w.id, w]));
  const ids = launcher.workflows.map((w) => w.id);
  if (ids.join() !== wfBuiltFor) {
    wfList.innerHTML = '';
    wfViews.clear();
    for (const id of ids) {
      const view = buildRow(id);
      wfViews.set(id, view);
      wfList.appendChild(view.el);
    }
    wfBuiltFor = ids.join();
  }
  ids.forEach(paint);

  const ready = launcher.workflows.filter((w) => w.runnable).length;
  setPanelCount('workflows', launcher.workflows.length ? `${ready} ready` : '');
  if (launcher.message) setNote(launcher.message, true);
  else if (!launcher.workflows.length) setNote('No workflow has a Webhook trigger yet. Add one in n8n to start it from here.', true);
  else if (launcher.others) setNote(`${launcher.others} other workflow${launcher.others > 1 ? 's have' : ' has'} no Webhook trigger.`);
  else setNote('');
}
