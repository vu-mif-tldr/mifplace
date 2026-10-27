import type { CanvasState } from '@mifplace/shared';
import type { PaletteColor } from './api';

// The canvas has 128x128 cells, each cell is 5x5 px on screen (640x640 px in total)
const CELL_SIZE = 5;

// Draw the whole canvas received from the server
export function drawCanvas(canvas: HTMLCanvasElement, state: CanvasState, palette: PaletteColor[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // White background for cells nobody has painted
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Color ids can have gaps, so look colors up by id, not by index in the list
  const colorById = new Map(palette.map(({ id, color }) => [id, color]));

  // Turn each position into a column (x) and a row (y)
  for (const [position, colorId] of state.pixels) {
    // Negative (unpainted) and unknown ids keep the background
    const color = colorById.get(colorId);
    if (!color) continue;

    const x = position % state.width;
    const y = Math.floor(position / state.width);
    paintCell(canvas, x, y, color);
  }
}

// Paint one cell (x = column, y = row)
export function paintCell(canvas: HTMLCanvasElement, x: number, y: number, color: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = color;
  ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
}

// Find which cell was clicked (offsetX/offsetY = click position inside the canvas)
export function getClickedCell(event: MouseEvent) {
  return {
    x: Math.floor(event.offsetX / CELL_SIZE),
    y: Math.floor(event.offsetY / CELL_SIZE),
  };
}
