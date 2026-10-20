// What the server and the browser agree on about the canvas. No Node or DOM APIs here: this
// package is used on both sides.

export interface Color {
  id: number;
  // "#RRGGBB"
  rgb: string;
}

// Value of a cell nobody has painted yet. color_id 0 is a real color (black).
export const EMPTY_CELL = 255;
// A cell is one byte, larger color ids would wrap. The server checks the palette against this.
export const MAX_COLOR_ID = EMPTY_CELL - 1;

// Body of GET /api/canvas: the header, then one byte per cell, row by row
// (position = y * width + x) with the color_id or EMPTY_CELL.
// The header is: version u8, then width, height and the id of the last event in the cells,
// each u32 little-endian.
// The version changes whenever the layout changes, the client refuses other versions.
export const CANVAS_FORMAT_VERSION = 1;
export const CANVAS_HEADER_BYTES = 13;
const WIDTH_OFFSET = 1;
const HEIGHT_OFFSET = 5;
const LAST_EVENT_ID_OFFSET = 9;

export interface CanvasHeader {
  width: number;
  height: number;
  // The last event included in the cells, later updates continue after it.
  lastEventId: number;
}

// cells[position] is the color_id of the cell or EMPTY_CELL.
export interface CanvasSnapshot extends CanvasHeader {
  cells: Uint8Array;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function writeCanvasHeader(bytes: Uint8Array, header: CanvasHeader): void {
  const v = view(bytes);
  v.setUint8(0, CANVAS_FORMAT_VERSION);
  v.setUint32(WIDTH_OFFSET, header.width, true);
  v.setUint32(HEIGHT_OFFSET, header.height, true);
  v.setUint32(LAST_EVENT_ID_OFFSET, header.lastEventId, true);
}

export function readLastEventId(bytes: Uint8Array): number {
  return view(bytes).getUint32(LAST_EVENT_ID_OFFSET, true);
}

export function writeLastEventId(bytes: Uint8Array, eventId: number): void {
  view(bytes).setUint32(LAST_EVENT_ID_OFFSET, eventId, true);
}

// Reads a body of GET /api/canvas. The cells share the memory of the buffer.
export function parseCanvas(buffer: ArrayBuffer): CanvasSnapshot {
  if (buffer.byteLength < CANVAS_HEADER_BYTES) {
    throw new Error(`Canvas snapshot: ${buffer.byteLength} bytes, too short for the header`);
  }
  const header = new DataView(buffer);
  const version = header.getUint8(0);
  if (version !== CANVAS_FORMAT_VERSION) {
    throw new Error(
      `Canvas snapshot: format version ${version}, expected ${CANVAS_FORMAT_VERSION}`
    );
  }
  const width = header.getUint32(WIDTH_OFFSET, true);
  const height = header.getUint32(HEIGHT_OFFSET, true);
  const lastEventId = header.getUint32(LAST_EVENT_ID_OFFSET, true);
  const cells = new Uint8Array(buffer, CANVAS_HEADER_BYTES);
  if (cells.length !== width * height) {
    throw new Error(
      `Canvas snapshot: ${cells.length} cells, expected ${width}x${height}=${width * height}`
    );
  }
  return { width, height, lastEventId, cells };
}
