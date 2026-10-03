'use strict';

// Writes src/preset.json: the service URLs (and enabled flags) from your config.json, so an
// installed copy starts out pointed at your homelab. API keys and webhook headers are
// deliberately left out: anything in the installer can be extracted from it.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'config.json');
const target = path.join(root, 'src', 'preset.json');

if (!fs.existsSync(source)) {
  fs.writeFileSync(target, '{}\n');
  console.log('preset: no config.json, shipping without preset URLs');
  process.exit(0);
}

const { services = {} } = JSON.parse(fs.readFileSync(source, 'utf8'));
const preset = { services: {} };
for (const [id, s] of Object.entries(services)) {
  preset.services[id] = { enabled: s.enabled !== false, url: s.url };
}
fs.writeFileSync(target, `${JSON.stringify(preset, null, 2)}\n`);
console.log(`preset: ${Object.entries(preset.services).map(([id, s]) => `${id}=${s.url}`).join(', ')} (no keys)`);
