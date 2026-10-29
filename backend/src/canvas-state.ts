import type { CanvasSize, CanvasState } from '@mifplace/shared';
import type { MifDb } from '@mifplace/db';

// The size is passed in: it is read once at start, so this does not ask the database for it.
export function getCanvasState(mifDb: MifDb, { width, height }: CanvasSize): CanvasState {
  const events = mifDb.iterateEvents(0);
  const pixels = new Map<number, number>();

  for (const event of events) {
    if (event.position >= width * height) continue;
    pixels.set(event.position, event.color_id);
  }

  return { pixels: Array.from(pixels) };
}
