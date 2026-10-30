import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS_DIR, MifDb, loadMigrations, migrate } from '@mifplace/db';
import { UNPAINTED } from './canvas-state.js';
import { loadCanvas, placePixel } from './canvas-log.js';

const size = { width: 4, height: 3 };

function openMifDb() {
  const db = new Database(':memory:');
  migrate(db, loadMigrations(MIGRATIONS_DIR));
  return new MifDb(db);
}

describe('loadCanvas', () => {
  it('is all unpainted with a 0/0 checkpoint for an empty log', () => {
    const mif = openMifDb();

    assert.deepEqual(loadCanvas(mif, size).snapshot(), {
      pixels: Array(12).fill(UNPAINTED),
      eventId: 0,
      timestamp: 0,
    });
    mif.close();
  });

  it('builds the canvas and the checkpoint from the log', () => {
    const mif = openMifDb();
    mif.appendEvent({ user_id: 0, color_id: 7, position: 5 }, 1000);
    mif.appendEvent({ user_id: 0, color_id: 2, position: 5 }, 2000);

    const snapshot = loadCanvas(mif, size).snapshot();
    assert.equal(snapshot.pixels[5], 2);
    assert.deepEqual([snapshot.eventId, snapshot.timestamp], [2, 2000]);
    mif.close();
  });
});

describe('placePixel', () => {
  it('saves the event to the log, then to memory, and returns its id', () => {
    const mif = openMifDb();
    const canvas = loadCanvas(mif, size);

    assert.equal(placePixel(mif, canvas, { user_id: 0, color_id: 6, position: 6 }, 5000), 1);

    const snapshot = canvas.snapshot();
    assert.equal(snapshot.pixels[6], 6);
    assert.deepEqual([snapshot.eventId, snapshot.timestamp], [1, 5000]);
    assert.deepEqual(mif.getPixelHistory(6, 10), [
      { id: 1, user_id: 0, color_id: 6, position: 6, timestamp: 5000 },
    ]);
    mif.close();
  });

  it('leaves memory as it was when the database rejects the event', () => {
    const mif = openMifDb();
    const canvas = loadCanvas(mif, size);
    placePixel(mif, canvas, { user_id: 0, color_id: 6, position: 6 }, 5000);
    const before = canvas.snapshot();

    // The events table has CHECK (position >= 0)
    assert.throws(() => placePixel(mif, canvas, { user_id: 0, color_id: 3, position: -1 }, 6000));
    assert.deepEqual(canvas.snapshot(), before);
    mif.close();
  });

  it('gives the same canvas after a restart: memory and the log agree', () => {
    const mif = openMifDb();
    const canvas = loadCanvas(mif, size);
    placePixel(mif, canvas, { user_id: 0, color_id: 6, position: 6 }, 5000);
    placePixel(mif, canvas, { user_id: 0, color_id: 1, position: 0 }, 6000);
    placePixel(mif, canvas, { user_id: 0, color_id: 3, position: 6 }, 7000);

    assert.deepEqual(loadCanvas(mif, size).snapshot(), canvas.snapshot());
    mif.close();
  });
});
