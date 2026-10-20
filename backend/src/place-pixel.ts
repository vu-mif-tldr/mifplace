import type { MifDb, Pixel } from '@mifplace/db';
import type { CanvasState } from './canvas-state.js';

export interface PixelLimits {
  // width * height of the canvas
  cellCount: number;
  colorIds: ReadonlySet<number>;
}

// The request is wrong, the caller gets the message (HTTP 400).
export class InvalidPixelError extends Error {}

// Checks the body of POST /api/pixel: { position, color_id }.
export function parsePixel(body: unknown, limits: PixelLimits): Pixel {
  if (typeof body !== 'object' || body === null) {
    throw new InvalidPixelError('Body must be a JSON object');
  }
  const { position, color_id } = body as Record<string, unknown>;
  if (
    typeof position !== 'number' ||
    !Number.isInteger(position) ||
    position < 0 ||
    position >= limits.cellCount
  ) {
    throw new InvalidPixelError(`position must be an integer from 0 to ${limits.cellCount - 1}`);
  }
  if (typeof color_id !== 'number' || !limits.colorIds.has(color_id)) {
    throw new InvalidPixelError('color_id is not in the palette');
  }
  return { position, color_id };
}

// Writes the pixel to the database first and to the memory state after that. If the
// database throws, the memory is not touched, so the state in memory never has a pixel
// that is missing in the log. Both steps are synchronous, nothing runs between them.
// Returns the id of the new event.
export function placePixel(
  mifDb: Pick<MifDb, 'appendEvent'>,
  canvas: Pick<CanvasState, 'setCell'>,
  pixel: Pixel,
  userId: number,
  now: number = Date.now()
): number {
  const id = mifDb.appendEvent({ user_id: userId, ...pixel }, now);
  canvas.setCell(pixel.position, pixel.color_id, id);
  return id;
}
