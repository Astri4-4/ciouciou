'use strict';

// Right-hand home card: a carousel of panels (Workflows, Activity, Models).
// Shares `ago` with workflows.js. Add a panel: a .panel block in island.html + a render function here.

const carousel = document.getElementById('carousel');
const track = document.getElementById('panel-track');
const panelTitle = document.getElementById('panel-title');
const panelCount = document.getElementById('panel-count');
const panelDots = document.getElementById('panel-dots');
const panels = [...track.querySelectorAll('.panel')];

const PANEL_KEY = 'ciouciou.panel';
const SWIPE_THRESHOLD = 40;
const SWIPE_COOLDOWN_MS = 500;

const panelCounts = {};
let currentPanel = 0;

function remember(fn) {
  try {
    return fn(window.localStorage);
  } catch {
    return null;
  }
}

// Each panel reports a short summary for the header; only the visible one is shown.
function setPanelCount(panel, text) {
  panelCounts[panel] = text || '';
  if (panels[currentPanel].dataset.panel === panel) panelCount.textContent = text ? ` · ${text}` : '';
}

function goToPanel(index, { save = true } = {}) {
  currentPanel = (index + panels.length) % panels.length;
  track.style.transform = `translate3d(${-currentPanel * 100}%, 0, 0)`;
  panels.forEach((p, i) => {
    const active = i === currentPanel;
    p.classList.toggle('active', active);
    p.inert = !active; // Off-screen panels can't be tabbed into or clicked.
  });
  [...panelDots.children].forEach((d, i) => d.classList.toggle('active', i === currentPanel));
  const panel = panels[currentPanel];
  panelTitle.textContent = panel.dataset.title;
  setPanelCount(panel.dataset.panel, panelCounts[panel.dataset.panel]);
  if (save) remember((s) => s.setItem(PANEL_KEY, panel.dataset.panel));
}

panels.forEach((p, i) => {
  const dot = document.createElement('button');
  dot.type = 'button';
  dot.className = 'dot';
  dot.title = p.dataset.title;
  dot.addEventListener('click', () => goToPanel(i));
  panelDots.appendChild(dot);
});
document.getElementById('panel-prev').addEventListener('click', () => goToPanel(currentPanel - 1));
document.getElementById('panel-next').addEventListener('click', () => goToPanel(currentPanel + 1));

// A horizontal touchpad swipe (or Shift+wheel) changes panel; a plain wheel still scrolls the list.
let swipeTotal = 0;
let swipeLockedUntil = 0;
carousel.addEventListener(
  'wheel',
  (e) => {
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!dx) return;
    e.preventDefault();
    if (Date.now() < swipeLockedUntil) return;
    swipeTotal += dx;
    if (Math.abs(swipeTotal) > SWIPE_THRESHOLD) {
      goToPanel(currentPanel + Math.sign(swipeTotal));
      swipeTotal = 0;
      swipeLockedUntil = Date.now() + SWIPE_COOLDOWN_MS;
    }
  },
  { passive: false },
);

function showNote(el, text, center = false) {
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('center', center);
}

// ---- Activity: latest n8n executions ----

const activityList = document.getElementById('activity');
const activityNote = document.getElementById('act-note');
const activityRows = new Map(); // execution id -> row, reused so clicks survive polls

function duration(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

function renderActivity(activity) {
  if (!activity) return;
  showNote(activityNote, activity.message, true);
  const keep = new Set();
  activity.runs.forEach((run, i) => {
    let row = activityRows.get(run.id);
    if (!row) {
      row = document.createElement('button');
      row.type = 'button';
      row.className = 'act';
      row.innerHTML = '<span class="run-dot"></span><span class="name"></span><span class="when"></span>';
      row.dataset.workflow = run.workflowId;
      row.dataset.id = run.id;
      activityRows.set(run.id, row);
    }
    const running = run.status === 'running' || run.status === 'new';
    row.children[0].className = `run-dot ${run.status}`;
    row.children[1].textContent = run.name;
    row.children[2].textContent = running
      ? `running · ${ago(run.at)}`
      : `${ago(run.at)} ago${run.durationMs != null ? ` · ${duration(run.durationMs)}` : ''}`;
    row.title = `${run.name} — ${run.status}\nOpen this execution in n8n`;
    if (activityList.children[i] !== row) activityList.insertBefore(row, activityList.children[i] || null);
    keep.add(run.id);
  });
  for (const [id, row] of activityRows) {
    if (!keep.has(id)) {
      row.remove();
      activityRows.delete(id);
    }
  }
  setPanelCount('activity', activity.message ? '' : `24h: ${activity.ok24h} ok, ${activity.failed24h} failed`);
}

activityList.addEventListener('click', (e) => {
  const row = e.target.closest('.act');
  if (row) window.ciouciou.n8n.openExecution(row.dataset.workflow, row.dataset.id);
});

// ---- Models: what Ollama has in memory and on disk ----

const modelsEl = document.getElementById('models');
const modelsNote = document.getElementById('models-note');
let modelsHtml = '';

function untilUnload(iso) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s <= 0) return 'unloading';
  if (s > 365 * 86400) return 'kept loaded';
  if (s < 60) return `unloads in ${Math.round(s)}s`;
  if (s < 3600) return `unloads in ${Math.round(s / 60)}m`;
  return `unloads in ${Math.round(s / 3600)}h`;
}

function renderModels(models) {
  if (!models) return;
  showNote(modelsNote, models.message, true);
  let html = '';
  if (!models.message) {
    const tile = (value, label) => `<div class="tile"><b>${escape(value)}</b><span>${escape(label)}</span></div>`;
    html += `<div class="tiles">${tile(models.loaded.length, 'in memory')}${tile(models.vram, 'VRAM used')}${tile(models.installed.length, `installed · ${models.disk}`)}</div>`;
    if (models.loaded.length) {
      html += '<div class="models-h">In memory</div>';
      html += models.loaded
        .map(
          (m) => `<div class="model"><span class="name on">${escape(m.name)}</span>
            <span class="gpu-bar" title="${m.gpu}% on GPU"><i style="width:${m.gpu}%"></i></span>
            <span class="meta">${m.gpu}% GPU · ${escape(m.size)} · ${untilUnload(m.expiresAt)}</span></div>`,
        )
        .join('');
    }
    html += '<div class="models-h">Installed</div>';
    html += models.installed
      .map(
        (m) => `<div class="model"><span class="name${m.loaded ? ' on' : ''}">${escape(m.name)}</span>
          ${m.params ? `<span class="tag">${escape(m.params)}</span>` : ''}${m.quant ? `<span class="tag">${escape(m.quant)}</span>` : ''}
          <span class="meta">${escape(m.size)}</span></div>`,
      )
      .join('');
  }
  if (html !== modelsHtml) {
    modelsEl.innerHTML = html; // No controls inside, so a rebuild can't swallow a click.
    modelsHtml = html;
  }
  setPanelCount('models', models.message ? '' : `${models.vram} in VRAM`);
}

function renderPanels(snapshot) {
  renderActivity(snapshot.activity);
  renderModels(snapshot.models);
}

const savedPanel = panels.findIndex((p) => p.dataset.panel === remember((s) => s.getItem(PANEL_KEY)));
goToPanel(Math.max(0, savedPanel), { save: false });
