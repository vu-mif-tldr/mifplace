import { EMPTY_CELL, type CanvasSnapshot, type Color } from './api';
import { logger } from './log';

const log = logger('canvas');

export const BACKGROUND_COLOR = '#FFFFFF';

export const SCALE_MIN = 1;
export const SCALE_MAX = 20;
// Width of the canvas border on each side, keep in sync with `#canvas` in styles.css.
export const CANVAS_BORDER = 1;

export interface Cell {
  x: number;
  y: number;
}

// The colour selected before the user picks one: the palette colour of the background, so
// that drawing without a choice does not suddenly paint in some colour. Falls back to the
// first colour if the palette has no such colour.
export function defaultColor(palette: Color[]): Color | null {
  const background = palette.find((c) => c.rgb.toUpperCase() === BACKGROUND_COLOR);
  return background ?? palette[0] ?? null;
}

// Cells of the straight line from a to b, both included, in order (Bresenham).
export function cellsOnLine(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  let { x, y } = a;
  for (;;) {
    cells.push({ x, y });
    if (x === b.x && y === b.y) return cells;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

// Fill colour of a cell: its palette colour, or the background for an empty cell and for a
// colour missing from the palette.
export function cellFill(colors: ReadonlyMap<number, string>, colorId: number): string {
  if (colorId === EMPTY_CELL) return BACKGROUND_COLOR;
  return colors.get(colorId) ?? BACKGROUND_COLOR;
}

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
    log.warn('cells with a colour missing from the palette, drawn as background', { unknown });
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
export function cellAt(canvas: HTMLCanvasElement, event: MouseEvent): Cell | null {
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.clientWidth / canvas.width;
  const x = Math.floor((event.clientX - rect.left - canvas.clientLeft) / scale);
  const y = Math.floor((event.clientY - rect.top - canvas.clientTop) / scale);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  return { x, y };
}
