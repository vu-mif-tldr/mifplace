import assert from 'node:assert/strict';
import * as zlib from 'node:zlib';
import { describe, it } from 'node:test';
import { CanvasState } from './canvas-state.js';

const { EMPTY, MAX_COLOR_ID, HEADER_BYTES, FORMAT_VERSION } = CanvasState;

describe('CanvasState', () => {
  const size = { width: 4, height: 2 };

  it('starts from the painted cells and serializes the header and all cells', () => {
    const state = new CanvasState(
      size,
      [
        { position: 5, color_id: 1 },
        { position: 0, color_id: 0 },
        { position: 7, color_id: MAX_COLOR_ID },
      ],
      42
    );
    const body = state.body('identity');
    assert.equal(body.readUInt8(0), FORMAT_VERSION);
    assert.equal(body.readUInt32LE(1), 4);
    assert.equal(body.readUInt32LE(5), 2);
    assert.equal(body.readUInt32LE(9), 42);
    assert.deepEqual(
      [...body.subarray(HEADER_BYTES)],
      [0, EMPTY, EMPTY, EMPTY, EMPTY, 1, EMPTY, MAX_COLOR_ID]
    );
  });

  it('the last set wins and drops the cached bodies', () => {
    const state = new CanvasState(size, [], 0);
    const empty = state.body('identity');
    assert.equal(state.body('identity'), empty);

    state.setCell(3, 0, 1);
    state.setCell(3, 1, 2);
    assert.equal(state.getCell(3), 1);
    assert.equal(state.getLastEventId(), 2);
    assert.equal(state.body('identity').readUInt32LE(9), 2);
    assert.notEqual(state.body('identity'), empty);
    assert.equal(state.body('identity')[HEADER_BYTES + 3], 1);
    // The body already handed out is a copy, the change does not reach it.
    assert.equal(empty[HEADER_BYTES + 3], EMPTY);
  });

  it('compressed bodies decode to the same bytes', () => {
    const state = new CanvasState(size, [{ position: 2, color_id: 3 }], 1);
    const raw = state.body('identity');
    assert.deepEqual(zlib.brotliDecompressSync(state.body('br')), raw);
    assert.deepEqual(zlib.gunzipSync(state.body('gzip')), raw);
  });
});
