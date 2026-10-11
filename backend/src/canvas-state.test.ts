import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CanvasState } from './canvas-state.js';

describe('CanvasState', () => {
  const size = { width: 4, height: 4 };

  it('starts from the painted cells and serializes them', () => {
    const state = new CanvasState(size, [{ position: 5, color_id: 1 }]);
    assert.deepEqual(JSON.parse(state.toJson()), {
      width: 4,
      height: 4,
      position: [5],
      color_id: [1],
    });
  });

  it('the last set wins and invalidates the cached json', () => {
    const state = new CanvasState(size, []);
    const empty = state.toJson();
    assert.equal(state.toJson(), empty);

    state.setCell(3, 0);
    state.setCell(3, 1);
    state.setCell(7, 0);
    const body = JSON.parse(state.toJson());
    assert.deepEqual(body.position, [3, 7]);
    assert.deepEqual(body.color_id, [1, 0]);
  });
});
