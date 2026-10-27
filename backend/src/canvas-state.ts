import type { CanvasState } from '@mifplace/shared';
import { MifDb } from './db.js';

export function getCanvasState(mifDb: MifDb): CanvasState {
  const { width, height } = mifDb.getCanvasSize();
  const events = mifDb.iterateEvents(0);
  const pixels = new Map<number, number>();

  for (const event of events) {
    if (event.position >= width * height) continue;
    pixels.set(event.position, event.color_id);
  }

  return { width, height, pixels: Array.from(pixels) };
}
