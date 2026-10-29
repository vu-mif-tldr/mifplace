import { describe, expect, it } from 'vitest';
import { cellError, fromPosition, toPosition } from './position.js';

const size = { width: 4, height: 3 };

describe('toPosition', () => {
  it('numbers the cells row by row', () => {
    expect(toPosition(size, 0, 0)).toBe(0);
    expect(toPosition(size, 3, 0)).toBe(3);
    expect(toPosition(size, 0, 1)).toBe(4);
    expect(toPosition(size, 3, 2)).toBe(11);
  });

  it('throws for a cell outside the canvas', () => {
    expect(() => toPosition(size, 4, 0)).toThrow(RangeError);
    expect(() => toPosition(size, 0, 3)).toThrow(/less than canvas height \(3\)/);
  });
});

describe('fromPosition', () => {
  it('is the reverse of toPosition for every cell', () => {
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        expect(fromPosition(size, toPosition(size, x, y))).toEqual({ x, y });
      }
    }
  });

  it('does not check the range', () => {
    expect(fromPosition(size, 12)).toEqual({ x: 0, y: 3 });
  });
});

describe('cellError', () => {
  it('accepts every cell of the canvas', () => {
    expect(cellError(size, 0, 0)).toBeUndefined();
    expect(cellError(size, 3, 2)).toBeUndefined();
  });

  it('names the reason for a cell outside the canvas', () => {
    expect(cellError(size, 4, 0)).toMatch(/x must be less than canvas width \(4\)/);
    expect(cellError(size, 0, 3)).toMatch(/y must be less than canvas height \(3\)/);
    expect(cellError(size, -1, 0)).toMatch(/must not be negative/);
    expect(cellError(size, 0, -1)).toMatch(/must not be negative/);
    expect(cellError(size, 0.5, 0)).toMatch(/must be integers/);
    expect(cellError(size, 0, Number.NaN)).toMatch(/must be integers/);
  });
});
