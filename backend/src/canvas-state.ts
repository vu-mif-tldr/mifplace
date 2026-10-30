import type { CanvasSize, CanvasState } from '@mifplace/shared';
import type { Checkpoint, PixelEvent } from './live/protocol.js';

// The color id of a cell nobody has painted (docs/api.md: any negative id is unpainted)
export const UNPAINTED = -1;

// An event of the log as the canvas needs it
export type CanvasEvent = PixelEvent & { timestamp: number };

// The canvas kept in memory, so GET /api/canvas does not read the event log.
// It knows nothing about the database: canvas-log.ts fills it from the log at start
// and applies every new event after it is saved.
export class CanvasStore {
  // The color id of every cell, index = pos: 4 bytes per cell, unlike a JS array
  private readonly pixels: Int32Array;
  // The last applied event, both 0 for an empty log
  private last: Checkpoint = { eventId: 0, timestamp: 0 };

  constructor({ width, height }: CanvasSize) {
    this.pixels = new Int32Array(width * height).fill(UNPAINTED);
  }

  apply({ eventId, pos, colorId, timestamp }: CanvasEvent) {
    // A position past the last cell (e.g. left over from a larger canvas) is not drawn,
    // but it is still in the log, so the checkpoint moves past it
    if (pos < this.pixels.length) this.pixels[pos] = colorId;
    this.last = { eventId, timestamp };
  }

  // The whole canvas with the checkpoint of its last event. Everything here is synchronous,
  // so no event can come between the copy of the pixels and the checkpoint.
  snapshot(): CanvasState {
    return { pixels: Array.from(this.pixels), ...this.last };
  }
}
