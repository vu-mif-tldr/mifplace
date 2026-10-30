import { z } from 'zod';
import type { CanvasSize } from './api.js';

// Canvas geometry: a cell (x = column, y = row) is sent and stored as one number,
// position = y * width + x (GET /api/canvas, the live messages, the events table).
// The API calls it pos, the events table keeps the column name position.

// Checks that (x, y) is a cell of the canvas and turns it into its position.
// cellSchema(size).safeParse({ x, y }) never throws: it gives { success: true, data: position }
// or { success: false, error } (see zodErrorMessage).
export function cellSchema(size: CanvasSize): CellSchema {
  // Building a zod schema costs far more than checking with it, and toPosition is called
  // once per pixel (e.g. by the PNG seed), so there is one schema per canvas size.
  return cached(cellSchemas, size, buildCellSchema);
}

// Checks that a position from a client (POST /api/pixels) is a cell of the canvas.
// The client computes it with toPosition, the server does not trust it and checks it again.
// positionSchema(size).safeParse({ pos }) never throws: like cellSchema, it gives
// { success: true, data: position } or { success: false, error }.
export function positionSchema(size: CanvasSize): PositionSchema {
  return cached(positionSchemas, size, buildPositionSchema);
}

type CellSchema = ReturnType<typeof buildCellSchema>;
type PositionSchema = ReturnType<typeof buildPositionSchema>;
const cellSchemas = new Map<string, CellSchema>();
const positionSchemas = new Map<string, PositionSchema>();

function cached<T>(
  schemas: Map<string, T>,
  { width, height }: CanvasSize,
  build: (width: number, height: number) => T
): T {
  const key = `${width}x${height}`;
  let schema = schemas.get(key);
  if (schema === undefined) {
    schema = build(width, height);
    schemas.set(key, schema);
  }
  return schema;
}

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

function buildPositionSchema(width: number, height: number) {
  const cells = width * height;
  return z
    .object({
      pos: z
        .int('pos must be an integer')
        .min(0, 'pos must not be negative')
        .max(cells - 1, `pos must be less than ${cells} (canvas ${width}x${height})`),
    })
    .transform(({ pos }) => pos);
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
