import { parseCanvas, type CanvasSnapshot } from '@mifplace/shared';
import { logger } from './log';

const log = logger('api');

// The canvas body and the Color type are shared with the server.
export { EMPTY_CELL, parseCanvas, type CanvasSnapshot, type Color } from '@mifplace/shared';

const SAVE_TIMEOUT_MS = 5000;

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return (await response.json()) as T;
}

// The browser undoes the Content-Encoding (br, gzip) itself.
export async function fetchCanvas(): Promise<CanvasSnapshot> {
  const started = performance.now();
  const response = await fetch('/api/canvas');
  if (!response.ok) throw new Error(`GET /api/canvas failed: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const snapshot = parseCanvas(buffer);
  log.info('canvas loaded', {
    width: snapshot.width,
    height: snapshot.height,
    lastEventId: snapshot.lastEventId,
    // After decompression, the transfer size is in the Network tab.
    bytes: buffer.byteLength,
    ms: Math.round(performance.now() - started),
  });
  return snapshot;
}

// Returns the id of the stored event.
export async function postPixel(position: number, colorId: number): Promise<number> {
  const response = await fetch('/api/pixel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position, color_id: colorId }),
    signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`POST /api/pixel failed: ${response.status}`);
  return ((await response.json()) as { id: number }).id;
}
