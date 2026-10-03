'use strict';

// Renders the yellow chick into build/icon.png (256×256), which electron-builder turns
// into the .exe / installer / shortcut icon. No image tooling needed: a minimal PNG encoder.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Chick = require('../src/chick');

const SIZE = 256;
const SCALE = 18;
const rgba = Buffer.alloc(SIZE * SIZE * 4); // Transparent background.
const ox = Math.floor((SIZE - Chick.WIDTH * SCALE) / 2);
const oy = Math.floor((SIZE - Chick.HEIGHT * SCALE) / 2);

for (const { x, y, color } of Chick.pixels('tray', 'up')) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let dy = 0; dy < SCALE; dy++) {
    for (let dx = 0; dx < SCALE; dx++) {
      const i = ((oy + y * SCALE + dy) * SIZE + ox + x * SCALE + dx) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
console.log(`icon: ${path.relative(process.cwd(), out)}`);
