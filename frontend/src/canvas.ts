import {
  fromPosition,
  type CanvasSize,
  type CanvasState,
  type PaletteColor,
} from '@mifplace/shared';

// The cells live in a source <canvas> that is not on the page, one pixel per cell; the loupe
// reads them from there too. The <canvas> on the page has the size of the viewport in screen
// pixels, and showCanvas copies the source onto it at the current zoom and offset, without
// smoothing. Scaling the source with a CSS transform and image-rendering: pixelated instead
// leaves the cells blurred in Safari.

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

// What the page shows: the viewport size and the canvas offset in CSS px, CSS px per cell,
// and screen pixels per CSS px (devicePixelRatio)
export type CanvasView = {
  width: number;
  height: number;
  x: number;
  y: number;
  cellPx: number;
  pixelRatio: number;
};

// Show the source canvas on the page canvas, each cell a block of screen pixels in one colour
export function showCanvas(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  size: CanvasSize,
  view: CanvasView
) {
  const width = Math.round(view.width * view.pixelRatio);
  const height = Math.round(view.height * view.pixelRatio);
  // Setting the size clears the canvas and resets the context, so only when it changes
  if (target.width !== width) target.width = width;
  if (target.height !== height) target.height = height;

  const ctx = target.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;

  // From cells to screen pixels
  const scale = view.cellPx * view.pixelRatio;
  ctx.setTransform(scale, 0, 0, scale, view.x * view.pixelRatio, view.y * view.pixelRatio);
  // White until the first snapshot is drawn on the source
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.width, size.height);
  if (source.width === size.width && source.height === size.height) ctx.drawImage(source, 0, 0);
}
