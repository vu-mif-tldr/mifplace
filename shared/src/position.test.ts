import { describe, expect, it } from 'vitest';
import { formatError } from './api.js';
import { cellSchema, fromPosition, toPosition } from './position.js';

const size = { width: 4, height: 3 };

describe('toPosition', () => {
  it('numbers the cells row by row', () => {
    expect(toPosition(size, 0, 0)).toBe(0);
    expect(toPosition(size, 3, 0)).toBe(3);
    expect(toPosition(size, 0, 1)).toBe(4);
    expect(toPosition(size, 3, 2)).toBe(11);
  });

  it('throws for a cell outside the canvas', () => {
    expect(() => toPosition(size, 4, 0)).toThrow(/less than canvas width \(4\)/);
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

describe('cellSchema', () => {
  const cell = cellSchema(size);

  // The error of a failed check, as an API response or an MCP tool result shows it
  const errorOf = (input: unknown) => {
    const result = cell.safeParse(input);
    if (result.success) throw new Error(`expected ${JSON.stringify(input)} to fail`);
    return formatError(result.error);
  };

  it('gives the position of every cell of the canvas', () => {
    expect(cell.safeParse({ x: 0, y: 0 })).toEqual({ success: true, data: 0 });
    expect(cell.safeParse({ x: 3, y: 2 })).toEqual({ success: true, data: 11 });
  });

  it('names the reason for a cell outside the canvas', () => {
    expect(errorOf({ x: 4, y: 0 })).toBe('x: x must be less than canvas width (4)');
    expect(errorOf({ x: 0, y: 3 })).toBe('y: y must be less than canvas height (3)');
    expect(errorOf({ x: -1, y: 0 })).toBe('x: x must not be negative');
    expect(errorOf({ x: 0, y: -1 })).toBe('y: y must not be negative');
    expect(errorOf({ x: 0.5, y: 0 })).toBe('x: x must be an integer');
    expect(errorOf({ x: 0, y: Number.NaN })).toBe('y: y must be an integer');
    expect(errorOf({ x: 4, y: 3 })).toBe(
      'x: x must be less than canvas width (4); y: y must be less than canvas height (3)'
    );
  });
});
