export interface Color {
  id: number;
  // "#RRGGBB"
  rgb: string;
}

// Only painted cells, as two parallel arrays: position[i] is painted with color_id[i].
// position = y * width + x.
export interface CanvasSnapshot {
  width: number;
  height: number;
  position: number[];
  color_id: number[];
}

const SAVE_TIMEOUT_MS = 5000;

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return (await response.json()) as T;
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
