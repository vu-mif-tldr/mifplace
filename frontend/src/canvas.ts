import type { CanvasState } from './api';
import { PALETTE } from './palette';

// Canvas size in cells (same as in the backend DB)
export const CANVAS_WIDTH = 128;
export const CANVAS_HEIGHT = 128;

// Cell size on screen: 128 * 5 = 640x640 px
export const PIXEL_SIZE = 5;

// Color of cells nobody has painted yet
const BACKGROUND_COLOR = '#ffffff';

// Draw the whole canvas received from the server
export function drawCanvas(canvas: HTMLCanvasElement, state: CanvasState) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Start from a blank canvas
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Turn each position into a column (x) and row (y)
  for (const [position, colorId] of state.pixels) {
    const x = position % state.width;
    const y = Math.floor(position / state.width);
    paintCell(canvas, x, y, PALETTE[colorId] ?? BACKGROUND_COLOR);
  }
}

// Paint one cell (x = column, y = row)
export function paintCell(canvas: HTMLCanvasElement, x: number, y: number, color: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = color;
  ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
}

// Which cell was clicked (offsetX/offsetY = position inside the canvas)
export function getClickedCell(event: MouseEvent) {
  return {
    x: Math.floor(event.offsetX / PIXEL_SIZE),
    y: Math.floor(event.offsetY / PIXEL_SIZE),
  };
}
