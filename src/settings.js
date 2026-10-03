'use strict';

const api = window.ciouciouSettings;
const form = document.getElementById('form');
const msg = document.getElementById('msg');
const SERVICES = ['ollama', 'openwebui', 'n8n'];
const FIELDS = { ollama: ['enabled', 'url'], openwebui: ['enabled', 'url', 'apiKey'], n8n: ['enabled', 'url', 'apiKey'] };

const chick = document.createElement('span');
chick.className = 'chick';
chick.style.cssText = Chick.paletteVars('tray');
chick.innerHTML = Chick.svg(4);
document.getElementById('chick').replaceWith(chick);

const field = (name) => form.elements.namedItem(name);

function setMessage(text, kind = '') {
  msg.textContent = text;
  msg.className = `msg ${kind}`;
}

function readForm() {
  const services = {};
  for (const id of SERVICES) {
    services[id] = {};
    for (const key of FIELDS[id]) {
      const el = field(`${id}.${key}`);
      services[id][key] = el.type === 'checkbox' ? el.checked : el.value.trim();
    }
  }
  return { services, launchAtStartup: field('launchAtStartup').checked };
}

function showStatus(results = []) {
  for (const id of SERVICES) {
    const status = form.querySelector(`fieldset[data-service="${id}"] .status`);
    const r = results.find((s) => s.id === id);
    status.className = `status ${r ? r.state : ''}`;
    status.textContent = r ? `${r.state === 'down' ? '✕' : '●'} ${r.summary}` : '';
  }
}

async function load() {
  const { values, launchAtStartup, canLaunchAtStartup, firstRun } = await api.get();
  for (const id of SERVICES) {
    for (const key of FIELDS[id]) {
      const el = field(`${id}.${key}`);
      const value = values.services[id]?.[key];
      if (el.type === 'checkbox') el.checked = value !== false;
      else el.value = value || '';
    }
  }
  field('launchAtStartup').checked = launchAtStartup;
  document.getElementById('startup-row').hidden = !canLaunchAtStartup;
  if (firstRun) {
    document.getElementById('title').textContent = 'Welcome to ciouciou!';
    document.getElementById('subtitle').textContent = 'Paste your API keys, test, then save. That’s it.';
  }
}

document.getElementById('test').addEventListener('click', async (e) => {
  e.target.disabled = true;
  setMessage('Testing…');
  showStatus();
  const results = await api.test(readForm());
  showStatus(results);
  const down = results.filter((r) => r.state === 'down' || r.state === 'degraded');
  setMessage(down.length ? `${down.length} service${down.length > 1 ? 's need' : ' needs'} attention` : 'All good!', down.length ? 'err' : 'ok');
  e.target.disabled = false;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const result = await api.save(readForm());
  if (result.ok) setMessage('Saved ✓', 'ok');
  else setMessage(result.error, 'err');
});

load();
