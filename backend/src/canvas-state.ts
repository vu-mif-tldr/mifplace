import type { CanvasSize, CanvasState } from '@mifplace/shared';
import type { EventRow, MifDb, NewEvent } from '@mifplace/db';
import type { Checkpoint } from './live/protocol.js';

// The color id of a cell nobody has painted (docs/api.md: any negative id is unpainted)
export const UNPAINTED = -1;

// The canvas kept in memory, so GET /api/canvas does not read the event log. It is built
// once from the log when the server starts and then changed by every new event (append).
// The backend is the only writer of the events table, so memory cannot miss an event.
export class CanvasStore {
  // The color id of every cell, index = position: 4 bytes per cell, unlike a JS array
  private readonly pixels: Int32Array;
  // The last event in pixels, both 0 for an empty log
  private last: Checkpoint = { eventId: 0, timestamp: 0 };

  // The size is passed in: it is read once at start, so this does not ask the database for it.
  constructor(
    private readonly mifDb: MifDb,
    { width, height }: CanvasSize
  ) {
    this.pixels = new Int32Array(width * height).fill(UNPAINTED);
    for (const event of mifDb.iterateEvents(0)) this.apply(event);
  }

  // Saves the event and returns its id. The database goes first: if the insert throws,
  // memory is not changed and still matches the log.
  append(event: NewEvent, now: number = Date.now()): number {
    const id = this.mifDb.appendEvent(event, now);
    this.apply({ ...event, id, timestamp: now });
    return id;
  }

  // The whole canvas with the checkpoint of its last event. Everything here is synchronous,
  // so no event can come between the copy of the pixels and the checkpoint.
  snapshot(): CanvasState {
    return { pixels: Array.from(this.pixels), ...this.last };
  }

  private apply(event: EventRow) {
    // A position past the last cell (e.g. left over from a larger canvas) is not drawn,
    // but it is still in the log, so the checkpoint moves past it
    if (event.position < this.pixels.length) this.pixels[event.position] = event.color_id;
    this.last = { eventId: event.id, timestamp: event.timestamp };
  }
}
