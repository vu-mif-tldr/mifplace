import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  EMPTY_CELL,
  PALETTE,
  type CanvasSnapshot,
  type PixelEvent,
  type PlaceResult,
} from '../shared/protocol.ts';

/**
 * In-memory stand-in for the append-only `events` table from ADR-0001: ids grow by 1 and the
 * canvas is derived from the log. It is lost on restart on purpose, so that the prototypes also
 * go through the "client is ahead of the server" path (see Hub.catchUp).
 */
export class EventLog {
  private readonly events: PixelEvent[] = [];
  private readonly cells = new Uint8Array(CANVAS_WIDTH * CANVAS_HEIGHT).fill(EMPTY_CELL);

  get lastId(): number {
    return this.events.length;
  }

  /** Validates an untrusted placement and appends it. The only way to add an event. */
  place(input: unknown): PlaceResult {
    const placement = parsePlacement(input);
    if (typeof placement === 'string') return { ok: false, error: placement };

    const event: PixelEvent = { id: this.events.length + 1, ...placement, ts: Date.now() };
    this.events.push(event);
    this.cells[event.y * CANVAS_WIDTH + event.x] = event.color;
    return { ok: true, id: event.id };
  }

  /** Events with afterId < id <= toId. */
  range(afterId: number, toId: number): PixelEvent[] {
    // Event k is stored at index k - 1.
    return this.events.slice(afterId, toId);
  }

  snapshot(): CanvasSnapshot {
    return {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      lastEventId: this.lastId,
      cells: Array.from(this.cells),
    };
  }
}

function parsePlacement(input: unknown): { x: number; y: number; color: number } | string {
  if (typeof input !== 'object' || input === null) return 'expected an object';
  const { x, y, color } = input as Record<string, unknown>;
  if (!isIndex(x, CANVAS_WIDTH) || !isIndex(y, CANVAS_HEIGHT))
    return 'x or y is outside the canvas';
  if (!isIndex(color, PALETTE.length)) return 'unknown color';
  return { x, y, color };
}

function isIndex(value: unknown, length: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < length;
}
