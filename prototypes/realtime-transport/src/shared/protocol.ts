// Wire protocol shared by the server and the browser client. Every transport carries exactly
// the same JSON messages, so the transports are compared on equal terms.

export const CANVAS_WIDTH = 64;
export const CANVAS_HEIGHT = 64;
/** Cell value of a pixel nobody has painted yet. */
export const EMPTY_CELL = 255;

export const PALETTE = [
  '#ffffff',
  '#222222',
  '#e50000',
  '#e59500',
  '#e5d900',
  '#02be01',
  '#0083c7',
  '#820080',
] as const;

export const TRANSPORTS = ['ws', 'sse', 'lp', 'poll'] as const;
export type TransportName = (typeof TRANSPORTS)[number];

/** One placed pixel. Ids start at 1 and grow by exactly 1, `ts` is the server time in ms. */
export interface PixelEvent {
  id: number;
  x: number;
  y: number;
  color: number;
  ts: number;
}

/** A PixelEvent on the wire: [id, x, y, color, ts]. */
export type WireEvent = [number, number, number, number, number];

export type PlaceResult = { ok: true; id: number } | { ok: false; error: string };

export type ServerMessage =
  /** Events with consecutive ids in ascending order. Empty when a poll finds nothing new. */
  | { t: 'batch'; events: WireEvent[] }
  /** The server cannot continue from the client's last event id: reload the snapshot. */
  | { t: 'reset' }
  /** Keep-alive, so that the client notices a dead connection. */
  | { t: 'hb' }
  /** Reply to a placement sent over the WebSocket. */
  | { t: 'placed'; req: number; result: PlaceResult };

/** Only the WebSocket sends placements over the same connection; the others use POST. */
export interface ClientMessage {
  t: 'place';
  req: number;
  x: number;
  y: number;
  color: number;
}

export interface CanvasSnapshot {
  width: number;
  height: number;
  /** Id of the last event included in `cells`. */
  lastEventId: number;
  cells: number[];
}

export function toWire(event: PixelEvent): WireEvent {
  return [event.id, event.x, event.y, event.color, event.ts];
}

export function fromWire([id, x, y, color, ts]: WireEvent): PixelEvent {
  return { id, x, y, color, ts };
}
