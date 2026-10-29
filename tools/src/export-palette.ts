// Writes the palette of the database as a .hex file (one rrggbb per line), to prepare a picture
// for db:seed:dev in an online pixel art editor, e.g. https://tezumie.github.io/Image-to-Pixel/
//
// Usage: npm run db:palette:export -w tools -- [palette.hex]
//   Without a file name the palette goes to stdout. A relative file name is taken from the
//   directory npm was started in.
// DB_PATH comes from the environment, then from .env in the repository root, see .env.example.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MifDb, loadDotEnv, openDb, resolveDbPath } from '@mifplace/db';
import { paletteToHex } from './png-canvas.js';

const [file] = process.argv.slice(2);

loadDotEnv();
const db = openDb(resolveDbPath());

try {
  const hex = paletteToHex(new MifDb(db).getPalette());
  if (file) {
    // npm runs the script in tools/, INIT_CWD is where the command was typed.
    fs.writeFileSync(path.resolve(process.env.INIT_CWD ?? '', file), hex);
    console.log(`Wrote ${file}: ${hex.trim().split('\n').length} colors`);
  } else {
    process.stdout.write(hex);
  }
} finally {
  db.close();
}
