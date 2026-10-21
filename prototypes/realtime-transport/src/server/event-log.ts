import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  EMPTY_CELL,
  PALETTE,
  fromWire,
  toWire,
  type CanvasSnapshot,
  type PixelEvent,
  type PlaceResult,
  type WireEvent,
} from '../shared/protocol.ts';

/**
 * Stand-in for the append-only `events` table from ADR-0001: ids grow by 1 and the canvas is
 * derived from the log. Without a file it lives in memory and is lost on restart, which exercises
 * the "client is ahead of the server" path (see Hub.catchUp). With a file it survives a restart,
 * as the real SQLite log will, and clients catch up instead of reloading the snapshot.
 */
export class EventLog {
  private readonly events: PixelEvent[] = [];
  private readonly cells = new Uint8Array(CANVAS_WIDTH * CANVAS_HEIGHT).fill(EMPTY_CELL);
  private readonly file: string | null;

  /** `file`: one JSON line per event, read back at startup. */
  constructor(file: string | null = null) {
    this.file = file;
    if (file === null) return;
    mkdirSync(path.dirname(file), { recursive: true });
    if (!existsSync(file)) return;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line !== '') this.add(fromWire(JSON.parse(line) as WireEvent));
    }
  }

  get lastId(): number {
    return this.events.length;
  }

  /** Validates an untrusted placement and appends it. The only way to add an event. */
  place(input: unknown): PlaceResult {
    const placement = parsePlacement(input);
    if (typeof placement === 'string') return { ok: false, error: placement };

    const event: PixelEvent = { id: this.events.length + 1, ...placement, ts: Date.now() };
    // Storage first, then memory, as in ADR-0001.
    if (this.file !== null) appendFileSync(this.file, `${JSON.stringify(toWire(event))}\n`);
    this.add(event);
    return { ok: true, id: event.id };
  }

  /** Events with afterId < id <= toId. */
  range(afterId: number, toId: number): PixelEvent[] {
    // Event k is stored at index k - 1.
    return this.events.slice(afterId, toId);
  }

  /** Time of event `id`; 0 for id 0, `undefined` for an id this log never issued. */
  tsOf(id: number): number | undefined {
    return id === 0 ? 0 : this.events[id - 1]?.ts;
  }

  snapshot(): CanvasSnapshot {
    return {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      lastEventId: this.lastId,
      lastEventTs: this.tsOf(this.lastId) ?? 0,
      cells: Array.from(this.cells),
    };
  }

  private add(event: PixelEvent): void {
    this.events.push(event);
    this.cells[event.y * CANVAS_WIDTH + event.x] = event.color;
  }
}

function parsePlacement(input: unknown): { x: number; y: number; color: number } | string {
  if (typeof input !== 'object' || input === null) return 'expected an object';
  const { x, y, color } = input as Record<string, unknown>;
  if (!isIndex(x, CANVAS_WIDTH) || !isIndex(y, CANVAS_HEIGHT)) {
    return 'x or y is outside the canvas';
  }
  if (!isIndex(color, PALETTE.length)) return 'unknown color';
  return { x, y, color };
}

function isIndex(value: unknown, length: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < length;
}
