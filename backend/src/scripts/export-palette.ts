// Writes the palette of the database as a .hex file (one rrggbb per line), to prepare a picture
// for db:seed:dev in an online pixel art editor, e.g. https://tezumie.github.io/Image-to-Pixel/
//
// Usage: npm run db:palette:export -w backend -- [palette.hex]
//   Without a file name the palette goes to stdout.
// Settings (DB_PATH) come from the environment, then from .env, see .env.example.
import * as fs from 'node:fs';
import { MifDb, openDb, resolveDbPath } from '../db.js';
import { loadDotEnv } from '../env.js';
import { paletteToHex } from './png-canvas.js';

const [file] = process.argv.slice(2);

loadDotEnv('.env');
const db = openDb(resolveDbPath());

try {
  const hex = paletteToHex(new MifDb(db).getPalette());
  if (file) {
    fs.writeFileSync(file, hex);
    console.log(`Wrote ${file}: ${hex.trim().split('\n').length} colors`);
  } else {
    process.stdout.write(hex);
  }
} finally {
  db.close();
}
