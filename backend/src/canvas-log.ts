import type { CanvasSize } from '@mifplace/shared';
import type { EventRow, MifDb, NewEvent } from '@mifplace/db';
import { CanvasStore, type CanvasEvent } from './canvas-state.js';

// The canvas in memory and the event log together: the log is the source of truth,
// memory is a copy of it that GET /api/canvas reads.

// Builds the canvas from the whole log, once at start. The size is passed in:
// it is read once at start, so this does not ask the database for it.
export function loadCanvas(mifDb: MifDb, size: CanvasSize): CanvasStore {
  const canvas = new CanvasStore(size);
  for (const row of mifDb.iterateEvents(0)) canvas.apply(toCanvasEvent(row));
  return canvas;
}

// Saves a new pixel and returns its event id. The database goes first: if the insert
// throws, memory is not changed and still matches the log. There is no rollback the other
// way: the log is append-only, and apply cannot fail for a position already on the canvas;
// if it ever did, memory would be rebuilt from the log at the next start.
export function placePixel(
  mifDb: MifDb,
  canvas: CanvasStore,
  event: NewEvent,
  now: number = Date.now()
): number {
  const id = mifDb.appendEvent(event, now);
  canvas.apply(toCanvasEvent({ ...event, id, timestamp: now }));
  return id;
}

function toCanvasEvent(row: EventRow): CanvasEvent {
  return { eventId: row.id, pos: row.position, colorId: row.color_id, timestamp: row.timestamp };
}
