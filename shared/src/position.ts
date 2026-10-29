import { z } from 'zod';
import type { CanvasSize } from './api.js';

// Canvas geometry: a cell (x = column, y = row) is sent and stored as one number,
// position = y * width + x (GET /api/canvas, the live messages, the events table).

// Checks that (x, y) is a cell of the canvas and turns it into its position.
// cellSchema(size).safeParse({ x, y }) never throws: it gives { success: true, data: position }
// or { success: false, error } (see formatError).
export function cellSchema({ width, height }: CanvasSize): CellSchema {
  // Building a zod schema costs far more than checking with it, and toPosition is called
  // once per pixel (e.g. by the PNG seed), so there is one schema per canvas size.
  const key = `${width}x${height}`;
  let schema = cellSchemas.get(key);
  if (schema === undefined) {
    schema = buildCellSchema(width, height);
    cellSchemas.set(key, schema);
  }
  return schema;
}

type CellSchema = ReturnType<typeof buildCellSchema>;
const cellSchemas = new Map<string, CellSchema>();

function buildCellSchema(width: number, height: number) {
  return z
    .object({
      // x >= width would silently address a cell on the next row
      x: z
        .int('x must be an integer')
        .min(0, 'x must not be negative')
        .max(width - 1, `x must be less than canvas width (${width})`),
      // y >= height is a position past the last cell
      y: z
        .int('y must be an integer')
        .min(0, 'y must not be negative')
        .max(height - 1, `y must be less than canvas height (${height})`),
    })
    .transform(({ x, y }) => y * width + x);
}

// The position of a cell that must be on the canvas: throws a ZodError otherwise,
// so a wrong (x, y) never becomes another cell.
export function toPosition(size: CanvasSize, x: number, y: number): number {
  return cellSchema(size).parse({ x, y });
}

// The reverse of toPosition. The range is not checked: a position past the last cell
// (e.g. left over from a larger canvas) gives y >= height.
export function fromPosition({ width }: CanvasSize, position: number): { x: number; y: number } {
  return { x: position % width, y: Math.floor(position / width) };
}
