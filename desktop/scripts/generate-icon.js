'use strict';

/**
 * Generates a PLACEHOLDER 512x512 application icon (blue rounded square with a
 * white "N") with no external dependencies, so the installer has a valid icon.
 *
 * *** This is not final branding. *** Replace desktop/build/icon.png with the
 * official NUMZ artwork (512x512 or larger PNG) and re-run the build.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const px = Buffer.alloc(SIZE * SIZE * 4, 0);

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

// Rounded square background (#2563eb).
const radius = 96;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const cx = Math.min(Math.max(x, radius), SIZE - 1 - radius);
    const cy = Math.min(Math.max(y, radius), SIZE - 1 - radius);
    if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) set(x, y, 0x25, 0x63, 0xeb);
  }
}

// White "N": two verticals and a diagonal.
const left = 150, right = 362, top = 130, bottom = 382, stroke = 46;
for (let y = top; y <= bottom; y++) {
  for (let x = left; x < left + stroke; x++) set(x, y, 255, 255, 255);
  for (let x = right - stroke; x < right; x++) set(x, y, 255, 255, 255);
  const t = (y - top) / (bottom - top);
  const dx = Math.round(left + t * (right - stroke - left));
  for (let x = dx; x < dx + stroke; x++) set(x, y, 255, 255, 255);
}

// PNG encode.
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.resolve(__dirname, '../build/icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`Wrote placeholder icon (${png.length} bytes) -> ${out}`);
