// DK: Dev-only measurement, not used by the application (see MP-63).
// Compares the size of the GET /api/canvas body for a large canvas in four formats:
// the current JSON (array of {position, color_id}), JSON with two parallel arrays
// (position[], color_id[]), 1 byte per pixel and 5 bits per pixel, each raw, gzip and brotli.
//
// Usage: npm run bench-canvas-format -w tools -- <pixil-frame-file.c>
//
// Scenarios:
// - the sprite from the file as is (real data, but few colours and few pixels);
// - 2000x2000 canvases generated from a fixed PRNG seed (small random rectangles with 2%
//   and 15% single-pixel noise, and uniform noise as the worst case). These are synthetic,
//   a real canvas may compress differently.
//
// Notes:
// - 0 means "empty cell", painted cells use 1..31, so 5 bits are enough for 31 colours.
// - 5 bits are packed MSB first, the last byte is padded with zeros.
// - Brotli quality 11 is slow (seconds), it is skipped for the JSON formats.
// - "build" is the time to produce the raw body. "parse" is JSON.parse in Node, only a rough
//   hint for the browser (JSON formats only).
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

const SIZE = 2000;

type Canvas = { w: number; h: number; px: Uint8Array };

// Deterministic PRNG, so runs are comparable.
let seed = 123456789;
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const randInt = (n: number): number => Math.floor(rnd() * n);

function realSprite(file: string): Canvas {
  const text = fs.readFileSync(file, 'utf8');
  const tokens = text.slice(text.indexOf('_data')).match(/0x[0-9a-fA-F]{8}/g) ?? [];
  const w = 128;
  const h = 128;
  const px = new Uint8Array(w * h);
  tokens.forEach((token, i) => {
    if (parseInt(token, 16) >>> 24) px[i] = 1;
  });
  return { w, h, px };
}

function rects(
  w: number,
  h: number,
  count: number,
  minSide: number,
  maxSide: number,
  noise: number
): Canvas {
  const px = new Uint8Array(w * h);
  px.fill(1 + randInt(31));
  for (let k = 0; k < count; k++) {
    const rw = minSide + randInt(maxSide - minSide);
    const rh = minSide + randInt(maxSide - minSide);
    const x0 = randInt(w - rw);
    const y0 = randInt(h - rh);
    const color = 1 + randInt(31);
    for (let y = y0; y < y0 + rh; y++) px.fill(color, y * w + x0, y * w + x0 + rw);
  }
  for (let k = 0; k < noise * w * h; k++) px[randInt(w * h)] = 1 + randInt(31);
  return { w, h, px };
}

function uniform(w: number, h: number): Canvas {
  const px = new Uint8Array(w * h);
  for (let i = 0; i < px.length; i++) px[i] = 1 + randInt(31);
  return { w, h, px };
}

function pack5(px: Uint8Array): Buffer {
  const out = Buffer.alloc(Math.ceil((px.length * 5) / 8));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const value of px) {
    acc = (acc << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 255;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits) out[o] = (acc << (8 - bits)) & 255;
  return out;
}

function toJson({ w, h, px }: Canvas): Buffer {
  const pixels: { position: number; color_id: number }[] = [];
  for (let i = 0; i < px.length; i++) {
    if (px[i]) pixels.push({ position: i, color_id: px[i] - 1 });
  }
  return Buffer.from(JSON.stringify({ width: w, height: h, pixels }));
}

// Structure of arrays: {width, height, position: [...], color_id: [...]}.
function toJsonSoa({ w, h, px }: Canvas): Buffer {
  const position: number[] = [];
  const color_id: number[] = [];
  for (let i = 0; i < px.length; i++) {
    if (px[i]) {
      position.push(i);
      color_id.push(px[i] - 1);
    }
  }
  return Buffer.from(JSON.stringify({ width: w, height: h, position, color_id }));
}

function timed<T>(f: () => T): [T, number] {
  const start = performance.now();
  const result = f();
  return [result, performance.now() - start];
}

const gzip = (b: Buffer): [Buffer, number] => timed(() => zlib.gzipSync(b, { level: 6 }));
const brotli = (b: Buffer, quality: number): [Buffer, number] =>
  timed(() =>
    zlib.brotliCompressSync(b, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
        [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length,
      },
    })
  );

const kb = (n: number): string => (n / 1024).toFixed(n < 10240 ? 1 : 0).padStart(9);
const ms = (n: number): string => `${n.toFixed(0)} ms`.padStart(8);

const file = process.argv[2];
if (!file) {
  console.error('Usage: bench-canvas-format <pixil-frame-file.c>');
  process.exit(1);
}

const scenarios: [string, Canvas][] = [
  ['real sprite 128x128 (1 colour, 17% painted)', realSprite(file)],
  ['2000x2000 small rects + 2% single-pixel noise', rects(SIZE, SIZE, 60000, 3, 60, 0.02)],
  ['2000x2000 small rects + 15% single-pixel noise', rects(SIZE, SIZE, 60000, 3, 60, 0.15)],
  ['2000x2000 uniform random (worst case)', uniform(SIZE, SIZE)],
];

for (const [name, canvas] of scenarios) {
  const painted = canvas.px.reduce((sum, v) => sum + (v ? 1 : 0), 0);
  console.log(`\n## ${name}  (${painted} painted)`);
  console.log(
    'format'.padEnd(22),
    'raw KB'.padStart(9),
    'gzip6 KB'.padStart(9),
    'br5 KB'.padStart(9),
    'br11 KB'.padStart(9),
    '  build  gzip6   br5   br11   parse'
  );
  const isLarge = canvas.px.length > 100000;
  const [json, jsonMs] = timed(() => toJson(canvas));
  const [jsonSoa, jsonSoaMs] = timed(() => toJsonSoa(canvas));
  const [byte, byteMs] = timed(() => Buffer.from(canvas.px));
  const [packed, packedMs] = timed(() => pack5(canvas.px));
  const rows: [string, Buffer, number][] = [
    ['JSON (current)', json, jsonMs],
    ['JSON arrays (SoA)', jsonSoa, jsonSoaMs],
    ['1 byte/pixel', byte, byteMs],
    ['5 bits/pixel', packed, packedMs],
  ];
  for (const [label, data, buildMs] of rows) {
    const [gz, gzMs] = gzip(data);
    const [br5, br5Ms] = brotli(data, 5);
    const skip11 = label.startsWith('JSON') && isLarge;
    const [br11, br11Ms] = skip11 ? [null, 0] : brotli(data, 11);
    // Client-side cost of reading the body; binary formats are read in place (not measured).
    const parseMs = label.startsWith('JSON') ? timed(() => JSON.parse(data.toString()))[1] : null;
    console.log(
      label.padEnd(22),
      kb(data.length),
      kb(gz.length),
      kb(br5.length),
      br11 ? kb(br11.length) : '   (skip)',
      ' ',
      ms(buildMs),
      ms(gzMs),
      ms(br5Ms),
      br11 ? ms(br11Ms) : '   -',
      parseMs === null ? '       -' : ms(parseMs)
    );
  }
}
