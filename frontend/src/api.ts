export interface Color {
  id: number;
  // "#RRGGBB"
  rgb: string;
}

// Value of a cell nobody has painted yet. color_id 0 is a real color (black).
export const EMPTY_CELL = 255;
// width and height, both u32 little-endian.
const CANVAS_HEADER_BYTES = 8;

// cells[position] is the color_id of the cell or EMPTY_CELL, position = y * width + x.
export interface CanvasSnapshot {
  width: number;
  height: number;
  cells: Uint8Array;
}

const SAVE_TIMEOUT_MS = 5000;

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return (await response.json()) as T;
}

// Body of GET /api/canvas: the header (width, height), then one byte per cell, row by row.
// Must match CanvasState on the backend.
export function parseCanvas(buffer: ArrayBuffer): CanvasSnapshot {
  if (buffer.byteLength < CANVAS_HEADER_BYTES) {
    throw new Error(`Canvas snapshot: ${buffer.byteLength} bytes, too short for the header`);
  }
  const header = new DataView(buffer);
  const width = header.getUint32(0, true);
  const height = header.getUint32(4, true);
  const cells = new Uint8Array(buffer, CANVAS_HEADER_BYTES);
  if (cells.length !== width * height) {
    throw new Error(`Canvas snapshot: ${cells.length} cells, expected ${width}x${height}`);
  }
  return { width, height, cells };
}

// The browser undoes the Content-Encoding (br, gzip) itself.
export async function fetchCanvas(): Promise<CanvasSnapshot> {
  const response = await fetch('/api/canvas');
  if (!response.ok) throw new Error(`GET /api/canvas failed: ${response.status}`);
  return parseCanvas(await response.arrayBuffer());
}

export async function postPixel(position: number, colorId: number): Promise<void> {
  const response = await fetch('/api/pixel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position, color_id: colorId }),
    signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`POST /api/pixel failed: ${response.status}`);
}
