import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { cellError, toPosition } from './position.js';

const size = { width: 4, height: 3 };

describe('toPosition', () => {
  it('numbers the cells row by row', () => {
    assert.equal(toPosition(size, 0, 0), 0);
    assert.equal(toPosition(size, 3, 0), 3);
    assert.equal(toPosition(size, 0, 1), 4);
    assert.equal(toPosition(size, 3, 2), 11);
  });

  it('throws for a cell outside the canvas', () => {
    assert.throws(() => toPosition(size, 4, 0), RangeError);
    assert.throws(() => toPosition(size, 0, 3), /less than canvas height \(3\)/);
  });
});

describe('cellError', () => {
  it('accepts every cell of the canvas', () => {
    assert.equal(cellError(size, 0, 0), undefined);
    assert.equal(cellError(size, 3, 2), undefined);
  });

  it('names the reason for a cell outside the canvas', () => {
    assert.match(cellError(size, 4, 0)!, /x must be less than canvas width \(4\)/);
    assert.match(cellError(size, 0, 3)!, /y must be less than canvas height \(3\)/);
    assert.match(cellError(size, -1, 0)!, /must not be negative/);
    assert.match(cellError(size, 0, -1)!, /must not be negative/);
    assert.match(cellError(size, 0.5, 0)!, /must be integers/);
    assert.match(cellError(size, 0, Number.NaN)!, /must be integers/);
  });
});
