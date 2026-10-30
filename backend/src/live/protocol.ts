// The WebSocket messages of /api/ws (docs/api.md, section 2) as pure functions:
// no socket and no database here, so the formats can be tested on their own.
// There is no heartbeat message: connection health uses WebSocket ping/pong frames.

// The last event a client has: from the GET /api/canvas snapshot or the last applied
// pixels message. Both fields are needed, ids can be reused after a database restore (ADR-0003).
export type Checkpoint = { eventId: number; timestamp: number };

// What the client asked for when it connected
export type ResumeRequest =
  | { kind: 'live' } // neither afterEventId nor afterTimestamp: only new events
  | { kind: 'resume'; after: Checkpoint } // both present and valid: catch up, then new events
  | { kind: 'invalid' }; // only one, or not a safe non-negative integer: the client gets RESET

// One event of a pixels message (pos = position, see toPosition)
export type PixelEvent = { eventId: number; pos: number; colorId: number };

// Reads the resume checkpoint from the query of /api/ws. Whether it is a known event of
// this database is not checked here, that needs the event log.
export function parseResumeRequest(query: URLSearchParams): ResumeRequest {
  const rawEventId = query.get('afterEventId');
  const rawTimestamp = query.get('afterTimestamp');
  if (rawEventId === null && rawTimestamp === null) return { kind: 'live' };

  const eventId = parseCount(rawEventId);
  const timestamp = parseCount(rawTimestamp);
  if (eventId === undefined || timestamp === undefined) return { kind: 'invalid' };
  return { kind: 'resume', after: { eventId, timestamp } };
}

// Digits only, so "", "-1", "1.5", "1e3" and " 1" are rejected; Number() alone would accept
// some of them. Above Number.MAX_SAFE_INTEGER the value could not be compared exactly.
function parseCount(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const count = Number(value);
  return Number.isSafeInteger(count) ? count : undefined;
}

// {"type":"pixels","pixels":[[eventId,pos,colorId],...],"eventId":..,"timestamp":..}:
// the same message for catch-up and live updates. last is the checkpoint the client saves
// after it has applied all the events.
export function encodePixels(events: PixelEvent[], last: Checkpoint): string {
  return JSON.stringify({
    type: 'pixels',
    pixels: events.map(({ eventId, pos, colorId }) => [eventId, pos, colorId]),
    eventId: last.eventId,
    timestamp: last.timestamp,
  });
}

// The checkpoint cannot be resumed: the client loads a new snapshot and connects again
export const RESET = JSON.stringify({ type: 'reset' });
