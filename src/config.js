'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  pollIntervalSeconds: 5,
  downAfterFailures: 2,
  services: {
    ollama: { enabled: true, url: 'http://localhost:11434' },
    openwebui: { enabled: true, url: 'http://localhost:3000', apiKey: '' },
    n8n: { enabled: true, url: 'http://localhost:5678', apiKey: '', webhookHeaders: {} },
  },
  notifications: {
    serviceDown: true,
    serviceUp: true,
    modelLoaded: true,
    workflowFailed: true,
    workflowStarted: true,
  },
  island: { enabled: true, position: 'center', theme: 'midnight' },
  chat: {
    shortcut: 'CommandOrControl+Alt+O',
    systemPrompt: '',
  },
};

// Environment variables win over the file, so secrets can stay out of config.json.
const ENV_OVERRIDES = {
  OLLAMA_URL: ['ollama', 'url'],
  OPENWEBUI_URL: ['openwebui', 'url'],
  OPENWEBUI_API_KEY: ['openwebui', 'apiKey'],
  N8N_URL: ['n8n', 'url'],
  N8N_API_KEY: ['n8n', 'apiKey'],
};

// Installed builds only look at the env override and the per-user file: the working
// directory of an app started at login is arbitrary.
function candidatePaths(userDataDir, packaged) {
  if (packaged) {
    return [process.env.CIOUCIOU_CONFIG, userDataDir && path.join(userDataDir, 'config.json')].filter(Boolean);
  }
  return [
    process.env.CIOUCIOU_CONFIG,
    path.join(process.cwd(), 'config.json'),
    path.join(__dirname, '..', 'config.json'),
    userDataDir && path.join(userDataDir, 'config.json'),
  ].filter(Boolean);
}

function merge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    const isObject = value && typeof value === 'object' && !Array.isArray(value);
    out[key] = isObject ? merge(base[key] || {}, value) : value;
  }
  return out;
}

// Optional defaults shipped with a build (homelab URLs, never keys); see scripts/make-preset.js.
const PRESET_FILE = path.join(__dirname, 'preset.json');

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function loadConfig(userDataDir, { packaged = false } = {}) {
  const file = candidatePaths(userDataDir, packaged).find((p) => fs.existsSync(p)) || null;
  const config = merge(merge(DEFAULTS, readJson(PRESET_FILE)), file ? readJson(file) : {});

  for (const [env, [service, key]] of Object.entries(ENV_OVERRIDES)) {
    if (process.env[env]) config.services[service][key] = process.env[env];
  }
  config.pollIntervalSeconds = Math.max(1, Number(config.pollIntervalSeconds) || DEFAULTS.pollIntervalSeconds);
  config.downAfterFailures = Math.max(1, Math.round(Number(config.downAfterFailures)) || DEFAULTS.downAfterFailures);

  return { config, file };
}

// Merges a partial config into the file (creating it if needed), keeping everything else as is.
function saveConfig(file, patch) {
  const next = merge(readJson(file), patch);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}
`);
}

module.exports = { loadConfig, saveConfig, merge, DEFAULTS };
