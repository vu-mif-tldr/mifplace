// Development only: fills the events table with a PNG picture.
//
// The PNG is not converted: every pixel must already be one of the palette colors. It starts
// at the top left corner of the canvas, the part of a larger picture outside the canvas is
// skipped. Prepare it in an online pixel art editor with the palette from
// `npm run db:palette:export -w tools` (see docs/development.md). A wrong color stops the script.
//
// Usage: npm run db:seed:dev -w tools -- <image.png>
//   A relative file name is taken from the directory npm was started in.
// DB_PATH comes from the environment, then from .env in the repository root, see .env.example.
//
// - Every non-transparent pixel becomes one event of user 0 (Test User), in one transaction.
// - events is append-only: a second run paints over the first one, the old events stay.
//   Recreate the database to start from an empty canvas.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MifDb, loadDotEnv, openDb, resolveDbPath } from '@mifplace/db';
import { decodePng, toCanvasPixels } from './png-canvas.js';

const SEED_USER_ID = 0;

const [file] = process.argv.slice(2);
if (!file) {
  console.error('Usage: seed-png <image.png>');
  process.exit(1);
}

loadDotEnv();
const db = openDb(resolveDbPath());

try {
  const mif = new MifDb(db);
  const image = decodePng(fs.readFileSync(path.resolve(process.env.INIT_CWD ?? '', file)));
  const canvas = mif.getCanvasSize();
  const pixels = toCanvasPixels(image, mif.getPalette(), canvas);
  if (image.width > canvas.width || image.height > canvas.height) {
    console.warn(
      `The ${image.width}x${image.height} picture is larger than the ${canvas.width}x${canvas.height} canvas, only the top left part is used`
    );
  }

  const now = Date.now();
  db.transaction(() => {
    for (const pixel of pixels) mif.appendEvent({ user_id: SEED_USER_ID, ...pixel }, now);
  })();
  console.log(`Inserted ${pixels.length} events, ${image.width}x${image.height}`);
} finally {
  db.close();
}
