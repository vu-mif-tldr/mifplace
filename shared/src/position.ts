import type { CanvasSize } from './index.js';

// Canvas geometry: a cell (x = column, y = row) is sent and stored as one number,
// position = y * width + x (GET /api/canvas, the live messages, the events table).

// Why (x, y) is not a cell of the canvas, or undefined if it is one.
export function cellError({ width, height }: CanvasSize, x: number, y: number): string | undefined {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'x and y must be integers';
  if (x < 0 || y < 0) return 'x and y must not be negative';
  // x >= width would silently address a cell on the next row
  if (x >= width) return `x must be less than canvas width (${width})`;
  // y >= height is a position past the last cell
  if (y >= height) return `y must be less than canvas height (${height})`;
  return undefined;
}

// Throws a RangeError for a cell outside the canvas, so a wrong (x, y) never becomes another cell.
export function toPosition(size: CanvasSize, x: number, y: number): number {
  const error = cellError(size, x, y);
  if (error !== undefined) throw new RangeError(`toPosition: ${error}`);
  return y * size.width + x;
}

// The reverse of toPosition. The range is not checked: a position past the last cell
// (e.g. left over from a larger canvas) gives y >= height.
export function fromPosition({ width }: CanvasSize, position: number): { x: number; y: number } {
  return { x: position % width, y: Math.floor(position / width) };
}
