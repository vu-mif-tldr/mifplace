import { EMPTY_CELL, type CanvasSnapshot, type Color } from './api';

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
  const unknown = fillRgba(image.data, palette, snap.cells);
  if (unknown > 0) {
    console.warn(`Canvas snapshot: ${unknown} cells have a color missing from the palette`);
  }
  ctx.putImageData(image, 0, 0);
  return ctx;
}

// Writes one RGBA pixel per cell. Empty cells and cells with a color missing from the
// palette get the background color. Returns the number of cells with a missing color.
export function fillRgba(rgba: Uint8ClampedArray, palette: Color[], cells: Uint8Array): number {
  const rgbById: [number, number, number][] = [];
  for (const c of palette) rgbById[c.id] = hexToRgb(c.rgb);
  const background = hexToRgb(BACKGROUND_COLOR);
  let unknown = 0;
  for (let i = 0; i < cells.length; i++) {
    let rgb = cells[i] === EMPTY_CELL ? background : rgbById[cells[i]];
    if (rgb === undefined) {
      unknown++;
      rgb = background;
    }
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = 255; //alpha
  }
  return unknown;
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
