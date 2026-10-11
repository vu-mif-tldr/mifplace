import type { CanvasSnapshot, Color } from './api';

const BACKGROUND_COLOR = '#FFFFFF';

export const SCALE_MIN = 1;
export const SCALE_MAX = 20;
// Width of the canvas border on each side, keep in sync with `#canvas` in styles.css.
export const CANVAS_BORDER = 1;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function drawSnapshot(
  canvas: HTMLCanvasElement,
  palette: Color[],
  snap: CanvasSnapshot
): CanvasRenderingContext2D {
  // The canvas keeps the real resolution, CSS scales it up without smoothing.
  canvas.width = snap.width;
  canvas.height = snap.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not supported');
  const image = ctx.createImageData(snap.width, snap.height);
  const background = hexToRgb(BACKGROUND_COLOR);
  const cellCount = snap.width * snap.height;
  for (let i = 0; i < cellCount; i++) {
    image.data.set([...background, 255], i * 4);
  }

  const colors = new Map(palette.map((c) => [c.id, c.rgb]));
  if (snap.position.length !== snap.color_id.length) {
    throw new Error('Canvas snapshot: position and color_id have different lengths');
  }
  for (let i = 0; i < snap.position.length; i++) {
    const position = snap.position[i];
    const color_id = snap.color_id[i];
    if (!Number.isInteger(position) || position < 0 || position >= cellCount) {
      console.warn(`Ignoring pixel outside the canvas: position ${position}, cells ${cellCount}`);
      continue;
    }
    const hex = colors.get(color_id);
    if (!hex) {
      console.warn(`Ignoring pixel with unknown color: position ${position}, color ${color_id}`);
      continue;
    }
    image.data.set([...hexToRgb(hex), 255], position * 4);
  }
  ctx.putImageData(image, 0, 0);
  return ctx;
}

// The largest whole scale at which the canvas, with its border, fits the available area
// completely: the side that is shorter relative to the canvas decides. Stays within [min, max].
export function fitScale(
  canvasWidth: number,
  canvasHeight: number,
  availableWidth: number,
  availableHeight: number,
  min: number = SCALE_MIN,
  max: number = SCALE_MAX
): number {
  const border = 2 * CANVAS_BORDER;
  const fit = Math.floor(
    Math.min((availableWidth - border) / canvasWidth, (availableHeight - border) / canvasHeight)
  );
  return Math.max(min, Math.min(max, fit));
}

// Cell under the mouse, or null outside the canvas. The scale is taken from the rendered size,
// so this stays correct for any scale. clientLeft/clientTop skip the border.
export function cellAt(
  canvas: HTMLCanvasElement,
  event: MouseEvent
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.clientWidth / canvas.width;
  const x = Math.floor((event.clientX - rect.left - canvas.clientLeft) / scale);
  const y = Math.floor((event.clientY - rect.top - canvas.clientTop) / scale);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  return { x, y };
}
