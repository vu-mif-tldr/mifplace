import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS_DIR, MifDb, loadMigrations, migrate } from '@mifplace/db';
import { CanvasStore, UNPAINTED } from './canvas-state.js';

const size = { width: 4, height: 3 };
const _ = UNPAINTED;

function openMifDb() {
  const db = new Database(':memory:');
  migrate(db, loadMigrations(MIGRATIONS_DIR));
  return new MifDb(db);
}

describe('CanvasStore', () => {
  it('is all unpainted with a 0/0 checkpoint for an empty log', () => {
    const mif = openMifDb();

    assert.deepEqual(new CanvasStore(mif, size).snapshot(), {
      pixels: Array(12).fill(UNPAINTED),
      eventId: 0,
      timestamp: 0,
    });
    mif.close();
  });

  it('builds the canvas from the log: the last color of every cell, index = position', () => {
    const mif = openMifDb();
    mif.appendEvent({ user_id: 0, color_id: 7, position: 5 }, 1000);
    mif.appendEvent({ user_id: 0, color_id: 4, position: 11 }, 2000);
    mif.appendEvent({ user_id: 0, color_id: 2, position: 5 }, 3000);

    assert.deepEqual(new CanvasStore(mif, size).snapshot(), {
      // prettier-ignore
      pixels: [
        _, _, _, _,
        _, 2, _, _,
        _, _, _, 4,
      ],
      eventId: 3,
      timestamp: 3000,
    });
    mif.close();
  });

  it('skips cells outside the canvas, but its checkpoint is the last event of the log', () => {
    const mif = openMifDb();
    mif.appendEvent({ user_id: 0, color_id: 7, position: 0 }, 1000);
    // Outside a 4 x 3 canvas, e.g. left over from a larger one
    mif.appendEvent({ user_id: 0, color_id: 7, position: 12 }, 2000);

    const snapshot = new CanvasStore(mif, size).snapshot();
    assert.equal(snapshot.pixels.length, 12);
    assert.equal(snapshot.pixels[0], 7);
    assert.deepEqual([snapshot.eventId, snapshot.timestamp], [2, 2000]);
    mif.close();
  });

  it('saves a new event to the log and to memory', () => {
    const mif = openMifDb();
    const canvas = new CanvasStore(mif, size);

    assert.equal(canvas.append({ user_id: 0, color_id: 6, position: 6 }, 5000), 1);

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
    const canvas = new CanvasStore(mif, size);
    canvas.append({ user_id: 0, color_id: 6, position: 6 }, 5000);
    const before = canvas.snapshot();

    // The events table has CHECK (position >= 0)
    assert.throws(() => canvas.append({ user_id: 0, color_id: 3, position: -1 }, 6000));
    assert.deepEqual(canvas.snapshot(), before);
    mif.close();
  });

  it('is the same after a restart: the canvas and the checkpoint come from the log', () => {
    const mif = openMifDb();
    const canvas = new CanvasStore(mif, size);
    canvas.append({ user_id: 0, color_id: 6, position: 6 }, 5000);
    canvas.append({ user_id: 0, color_id: 1, position: 0 }, 6000);
    canvas.append({ user_id: 0, color_id: 3, position: 6 }, 7000);

    assert.deepEqual(new CanvasStore(mif, size).snapshot(), canvas.snapshot());
    mif.close();
  });

  it('gives a copy, so a sent snapshot does not change with later events', () => {
    const mif = openMifDb();
    const canvas = new CanvasStore(mif, size);
    const before = canvas.snapshot();

    canvas.append({ user_id: 0, color_id: 6, position: 6 }, 5000);
    assert.equal(before.pixels[6], UNPAINTED);
    mif.close();
  });
});
