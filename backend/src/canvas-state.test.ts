import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS_DIR, MifDb, loadMigrations, migrate } from '@mifplace/db';
import { getCanvasState } from './canvas-state.js';

describe('getCanvasState', () => {
  it('keeps the last color of every pixel and skips pixels outside the canvas', () => {
    const db = new Database(':memory:');
    migrate(db, loadMigrations(MIGRATIONS_DIR));
    const mif = new MifDb(db);

    // Outside a 128 x 128 canvas, e.g. left over from a larger one
    mif.appendEvent({ user_id: 0, color_id: 7, position: 256 * 256 }, 1000);
    mif.appendEvent({ user_id: 0, color_id: 7, position: 5 }, 2000);
    mif.appendEvent({ user_id: 0, color_id: 4, position: 10 }, 3000);
    mif.appendEvent({ user_id: 0, color_id: 2, position: 5 }, 4000);

    assert.deepEqual(getCanvasState(mif, { width: 128, height: 128 }), {
      pixels: [
        [5, 2],
        [10, 4],
      ],
    });
    mif.close();
  });
});
