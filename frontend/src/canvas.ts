import {
  fromPosition,
  type CanvasSize,
  type CanvasState,
  type PaletteColor,
} from '@mifplace/shared';

// The <canvas> element has one pixel per cell. It is scaled up on screen with a CSS
// transform, so cells stay sharp (image-rendering: pixelated) at any size.

// Draw the whole canvas received from the server
export function drawCanvas(
  canvas: HTMLCanvasElement,
  size: CanvasSize,
  state: CanvasState,
  palette: PaletteColor[]
) {
  // A snapshot of another size would shift every row, so it is not drawn at all
  if (state.pixels.length !== size.width * size.height) {
    throw new Error(
      `The canvas has ${state.pixels.length} cells, expected ${size.width}x${size.height}`
    );
  }

  // Setting the size also clears the canvas
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // White background for cells nobody has painted
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.width, size.height);

  // Color ids can have gaps, so look colors up by id, not by index in the list
  const colorById = new Map(palette.map(({ id, color }) => [id, color]));

  // The index of a cell in pixels is its position
  state.pixels.forEach((colorId, position) => {
    // Negative (unpainted) and unknown ids keep the background
    const color = colorById.get(colorId);
    if (!color) return;

    const { x, y } = fromPosition(size, position);
    paintCell(canvas, x, y, color);
  });
}

// Paint one cell (x = column, y = row)
export function paintCell(canvas: HTMLCanvasElement, x: number, y: number, color: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

// Find which cell was clicked. The position is taken from the canvas rectangle on screen,
// so it is right at any zoom: offsetX can be rounded to whole pixels, and one pixel
// of the element is a whole cell.
export function getClickedCell(event: MouseEvent, size: CanvasSize) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const cell = (client: number, start: number, length: number, cells: number) =>
    // A click exactly on the far edge still belongs to the last cell
    Math.min(cells - 1, Math.max(0, Math.floor(((client - start) / length) * cells)));

  return {
    x: cell(event.clientX, rect.left, rect.width, size.width),
    y: cell(event.clientY, rect.top, rect.height, size.height),
  };
}
