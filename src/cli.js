'use strict';

// Headless status: `node src/cli.js --once` prints one snapshot, without it keeps watching.

const { loadConfig } = require('./config');
const { Monitor } = require('./monitor');

const ICONS = { up: '●', busy: '◉', degraded: '▲', down: '✕', unknown: '○' };

function print(snapshot) {
  const time = new Date(snapshot.updatedAt).toLocaleTimeString();
  console.log(`\n[${time}] overall: ${snapshot.overall}`);
  for (const s of snapshot.services) {
    console.log(`  ${ICONS[s.state] || '?'} ${s.name.padEnd(11)} ${s.state.padEnd(9)} ${s.summary}`);
    for (const d of s.details) console.log(`      ${d}`);
  }
}

const { config, file } = loadConfig();
console.log(`config: ${file || '(defaults)'}`);

const monitor = new Monitor(config);
monitor.on('event', (e) => console.log(`  >> ${e.title}: ${e.body}`));

if (process.argv.includes('--once')) {
  monitor.tick().then((snapshot) => {
    print(snapshot);
    process.exitCode = snapshot.overall === 'down' ? 1 : 0;
  });
} else {
  monitor.on('update', print);
  monitor.start();
}
