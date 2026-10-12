import * as zlib from 'node:zlib';
import type { CanvasSize, Pixel } from './db.js';

export type ContentEncoding = 'br' | 'gzip' | 'identity';

// Brotli's default quality 11 takes seconds on a large canvas, 5 is fast and almost as small
// (see bench-canvas-format.ts).
const BROTLI_QUALITY = 5;
// Offset of last_event_id in the header, see HEADER_BYTES.
const LAST_EVENT_ID_OFFSET = 9;

// Current state of the canvas, kept in memory so that GET /api/canvas does not touch the database.
// Built once at server start from the database; every event appended later must also go through
// setCell(), otherwise the state goes stale. Only one server process may write to the database.
export class CanvasState {
  // Marks a cell nobody has painted yet. color_id 0 is a real color (black), so it cannot be used.
  static readonly EMPTY = 255;
  // A byte silently wraps larger values, the server checks the palette against this at start.
  static readonly MAX_COLOR_ID = CanvasState.EMPTY - 1;
  // Changes whenever the layout of the body changes, the client refuses other versions.
  static readonly FORMAT_VERSION = 1;
  // version u8, then width, height and the id of the last event in the cells, each u32
  // little-endian.
  static readonly HEADER_BYTES = 13;

  // Body of GET /api/canvas, kept ready to send: the header, then one byte per cell
  // (position = y * width + x) with the color_id or EMPTY. 1 MB for 1000x1000, a Map with
  // 632k painted cells (1M random events) took ~28 MB.
  private readonly bytes: Buffer;
  // The cells part of bytes, the same memory.
  private readonly cells: Uint8Array;
  // Response bodies by encoding, dropped on every change and rebuilt on the next read.
  private readonly bodies = new Map<ContentEncoding, Buffer>();

  // lastEventId is the id of the last event included in painted (0 for an empty log).
  constructor(size: CanvasSize, painted: Iterable<Pixel>, lastEventId: number) {
    this.bytes = Buffer.alloc(
      CanvasState.HEADER_BYTES + size.width * size.height,
      CanvasState.EMPTY
    );
    this.bytes.writeUInt8(CanvasState.FORMAT_VERSION, 0);
    this.bytes.writeUInt32LE(size.width, 1);
    this.bytes.writeUInt32LE(size.height, 5);
    this.bytes.writeUInt32LE(lastEventId, LAST_EVENT_ID_OFFSET);
    this.cells = this.bytes.subarray(CanvasState.HEADER_BYTES);
    for (const p of painted) this.cells[p.position] = p.color_id;
  }

  // color_id of the cell, or EMPTY.
  getCell(position: number): number {
    return this.cells[position];
  }

  // Id of the last event applied to the cells.
  getLastEventId(): number {
    return this.bytes.readUInt32LE(LAST_EVENT_ID_OFFSET);
  }

  // Applies the event with the given id. Positions are validated before an event is appended,
  // there is no bounds check here.
  setCell(position: number, colorId: number, eventId: number): void {
    this.cells[position] = colorId;
    this.bytes.writeUInt32LE(eventId, LAST_EVENT_ID_OFFSET);
    this.bodies.clear();
  }

  // Body of GET /api/canvas in the given Content-Encoding. 'identity' is a copy as well:
  // the socket may still be sending it when the next setCell() changes the cells.
  body(encoding: ContentEncoding): Buffer {
    let body = this.bodies.get(encoding);
    if (body === undefined) {
      if (encoding === 'br') {
        body = zlib.brotliCompressSync(this.bytes, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
        });
      } else if (encoding === 'gzip') {
        body = zlib.gzipSync(this.bytes);
      } else {
        body = Buffer.from(this.bytes);
      }
      this.bodies.set(encoding, body);
    }
    return body;
  }
}
