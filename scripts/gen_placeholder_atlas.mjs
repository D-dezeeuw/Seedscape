// One-shot generator for a placeholder tile atlas.
// Produces public/atlas.png: 2048x2048, 64x64 grid of 32x32 tiles, each tile a
// distinct color derived from its (x, y) index. Replace with real art later.

import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const SIZE = 2048;
const TILES = 64;
const TILE = SIZE / TILES;

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

const stride = SIZE * 3;
const raw = Buffer.alloc(SIZE * (1 + stride));
for (let y = 0; y < SIZE; y++) {
  raw[y * (1 + stride)] = 0;
  for (let x = 0; x < SIZE; x++) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const idx = ty * TILES + tx;
    const hue = (idx * 0.6180339887) % 1;
    const sat = 0.55 + ((idx % 7) / 7) * 0.35;
    const val = 0.55 + ((idx % 5) / 5) * 0.35;
    const [r, g, b] = hsvToRgb(hue, sat, val);
    const inLocal = ((x % TILE) === 0) || ((y % TILE) === 0);
    const off = y * (1 + stride) + 1 + x * 3;
    raw[off] = inLocal ? 32 : r;
    raw[off + 1] = inLocal ? 32 : g;
    raw[off + 2] = inLocal ? 32 : b;
  }
}

const compressed = deflateSync(raw, { level: 9 });

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 2;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);

writeFileSync("public/atlas.png", png);
console.log(`Wrote public/atlas.png (${png.length} bytes)`);
