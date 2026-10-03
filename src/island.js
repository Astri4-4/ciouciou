'use strict';

const island = document.getElementById('island');
const chicksBar = document.getElementById('chicks');
const headline = document.getElementById('headline');
const services = document.getElementById('services');
const updated = document.getElementById('updated');

const STATES = ['up', 'busy', 'degraded', 'down', 'unknown'];
const STATE_LABEL = { up: 'idle', busy: 'busy', degraded: 'degraded', down: 'down', unknown: '…' };
const FLASH_MS = 5000;

let last = null;
let builtFor = '';
let flashTimer = null;
const views = new Map(); // service id -> { barChick, rowChick, row, name, state, sum, list }

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function makeChick(service, scale) {
  const el = document.createElement('span');
  el.className = 'chick unknown';
  // A random negative delay keeps the chicks from bobbing and blinking in sync.
  el.style.cssText = `${Chick.paletteVars(service)};--delay:-${(Math.random() * 4).toFixed(2)}s`;
  el.innerHTML = Chick.svg(scale);
  return el;
}

function setChickState(el, state) {
  for (const s of STATES) el.classList.toggle(s, s === state);
}

function cheer(el) {
  el.classList.remove('cheer');
  void el.offsetWidth; // Restart the animation if it's already running.
  el.classList.add('cheer');
  setTimeout(() => el.classList.remove('cheer'), 1500);
}

function headlineFor(snapshot) {
  const by = (state) => snapshot.services.filter((s) => s.state === state);
  const down = by('down');
  const busy = by('busy');
  const degraded = by('degraded');
  if (busy.length) return busy.map((s) => `${s.name}: ${s.summary}`).join(' · ');
  if (down.length) return `${down.map((s) => s.name).join(', ')} down`;
  if (degraded.length) return degraded.map((s) => `${s.name}: ${s.summary}`).join(' · ');
  if (!snapshot.services.length) return 'No services enabled';
  if (snapshot.overall === 'unknown') return 'Hatching…';
  return 'All quiet in the nest';
}

// Elements are built once per set of services and then updated in place, so the
// sprite animations keep running smoothly across polls.
function build(list) {
  chicksBar.innerHTML = '';
  services.innerHTML = '';
  views.clear();
  for (const s of list) {
    const barChick = makeChick(s.id, 2);
    chicksBar.appendChild(barChick);

    const row = document.createElement('div');
    row.className = 'svc';
    row.dataset.id = s.id;
    row.innerHTML = `
      <div class="avatar"></div>
      <div class="body">
        <div class="row"><b class="name"></b><span class="state"></span></div>
        <div class="sum"></div>
        <ul></ul>
      </div>`;
    const rowChick = makeChick(s.id, 3);
    row.querySelector('.avatar').appendChild(rowChick);
    services.appendChild(row);

    views.set(s.id, {
      barChick,
      rowChick,
      row,
      name: row.querySelector('.name'),
      state: row.querySelector('.state'),
      sum: row.querySelector('.sum'),
      list: row.querySelector('ul'),
    });
  }
  builtFor = list.map((s) => s.id).join();
}

function render(snapshot) {
  last = snapshot;
  if (snapshot.services.map((s) => s.id).join() !== builtFor) build(snapshot.services);

  for (const s of snapshot.services) {
    const v = views.get(s.id);
    setChickState(v.barChick, s.state);
    setChickState(v.rowChick, s.state);
    v.barChick.title = `${s.name}: ${s.summary}`;
    v.name.textContent = s.name;
    v.state.className = `state ${s.state}`;
    v.state.textContent = STATE_LABEL[s.state] || s.state;
    v.sum.textContent = s.summary;
    const list = s.details.map((d) => `<li>${escape(d)}</li>`).join('');
    if (v.list.innerHTML !== list) v.list.innerHTML = list; // Skip layout work when nothing changed.
    v.row.classList.toggle('link', Boolean(s.webUrl));
    v.row.title = s.webUrl ? `Open ${s.webUrl}` : '';
  }

  renderWorkflows(snapshot.launcher);
  renderPanels(snapshot);

  if (!flashTimer) headline.textContent = headlineFor(snapshot);
  updated.textContent = `Updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}`;
}

// A notification makes that service's chick jump and briefly takes over the headline.
function onEvent(event) {
  const v = views.get(event.service);
  if (v) {
    cheer(v.barChick);
    cheer(v.rowChick);
  }
  headline.textContent = `${event.title}: ${event.body}`;
  headline.classList.add('flash');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashTimer = null;
    headline.classList.remove('flash');
    if (last) headline.textContent = headlineFor(last);
  }, FLASH_MS);
}

// The window is a fixed, mostly transparent, click-through area; all motion is CSS.
// While the pointer is over the island, main stops passing clicks through.
const COLLAPSE_DELAY_MS = 220;
let collapseTimer = null;

function setExpanded(value) {
  island.classList.toggle('expanded', value);
}

island.addEventListener('mouseenter', () => {
  clearTimeout(collapseTimer);
  window.ciouciou.setInteractive(true);
  setExpanded(true);
});
island.addEventListener('mouseleave', () => {
  window.ciouciou.setInteractive(false);
  clearTimeout(collapseTimer);
  // A short grace period so grazing the edge doesn't snap it shut.
  collapseTimer = setTimeout(() => setExpanded(false), COLLAPSE_DELAY_MS);
});

// Theme swatches in the home footer.
const themePicker = document.getElementById('theme');
for (const t of Themes.THEMES) {
  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className = `swatch ${t.id}`;
  swatch.dataset.theme = t.id;
  swatch.title = t.label;
  themePicker.appendChild(swatch);
}
themePicker.addEventListener('click', (e) => {
  const swatch = e.target.closest('.swatch');
  if (swatch) window.ciouciou.setTheme(swatch.dataset.theme);
});

function applyTheme(theme) {
  document.body.dataset.theme = Themes.isTheme(theme) ? theme : Themes.DEFAULT_THEME;
  for (const s of themePicker.children) s.classList.toggle('active', s.dataset.theme === document.body.dataset.theme);
}
document.getElementById('ask').addEventListener('click', () => window.ciouciou.chat.setOpen(true));
services.addEventListener('click', (e) => {
  const svc = e.target.closest('.svc.link');
  if (svc) window.ciouciou.open(svc.dataset.id);
});
document.getElementById('refresh').addEventListener('click', () => window.ciouciou.refresh());

window.ciouciou.onSnapshot(render);
window.ciouciou.onEvent(onEvent);
window.ciouciou.onTheme(applyTheme);
window.ciouciou.onPosition((position) => {
  document.body.classList.toggle('notch', position !== 'left' && position !== 'right');
  document.body.classList.toggle('pos-left', position === 'left');
  document.body.classList.toggle('pos-right', position === 'right');
});
