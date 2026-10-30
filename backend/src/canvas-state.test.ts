import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { CanvasStore, UNPAINTED } from './canvas-state.js';

const size = { width: 4, height: 3 };
const _ = UNPAINTED;

describe('CanvasStore', () => {
  it('starts all unpainted with a 0/0 checkpoint', () => {
    assert.deepEqual(new CanvasStore(size).snapshot(), {
      pixels: Array(12).fill(UNPAINTED),
      eventId: 0,
      timestamp: 0,
    });
  });

  it('keeps the last color of every cell, index = pos, and the last event as checkpoint', () => {
    const canvas = new CanvasStore(size);
    canvas.apply({ eventId: 1, pos: 5, colorId: 7, timestamp: 1000 });
    canvas.apply({ eventId: 2, pos: 11, colorId: 4, timestamp: 2000 });
    canvas.apply({ eventId: 3, pos: 5, colorId: 2, timestamp: 3000 });

    assert.deepEqual(canvas.snapshot(), {
      // prettier-ignore
      pixels: [
        _, _, _, _,
        _, 2, _, _,
        _, _, _, 4,
      ],
      eventId: 3,
      timestamp: 3000,
    });
  });

  it('skips a cell outside the canvas, but moves the checkpoint past it', () => {
    const canvas = new CanvasStore(size);
    canvas.apply({ eventId: 1, pos: 0, colorId: 7, timestamp: 1000 });
    // Outside a 4 x 3 canvas, e.g. left over from a larger one
    canvas.apply({ eventId: 2, pos: 12, colorId: 7, timestamp: 2000 });

    const snapshot = canvas.snapshot();
    assert.equal(snapshot.pixels.length, 12);
    assert.equal(snapshot.pixels[0], 7);
    assert.deepEqual([snapshot.eventId, snapshot.timestamp], [2, 2000]);
  });

  it('gives a copy, so a sent snapshot does not change with later events', () => {
    const canvas = new CanvasStore(size);
    const before = canvas.snapshot();

    canvas.apply({ eventId: 1, pos: 6, colorId: 6, timestamp: 5000 });
    assert.equal(before.pixels[6], UNPAINTED);
  });
});
