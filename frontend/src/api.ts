import {
  CanvasSizeSchema,
  CanvasStateSchema,
  PaletteSchema,
  formatError,
  type CanvasSize,
  type CanvasState,
  type PaletteColor,
  type PlacePixelRequest,
} from '@mifplace/shared';

// TypeScript types are not checked at runtime, so every response is checked with the schema
// of its type from @mifplace/shared before it is used.

// Get the color palette from the server
export async function getPalette(): Promise<PaletteColor[]> {
  const response = await fetch('/api/palette');
  if (!response.ok) throw new Error('Could not load the palette');
  const palette = PaletteSchema.safeParse(await response.json());
  if (!palette.success) {
    throw new Error(`The palette from the server is invalid: ${formatError(palette.error)}`);
  }
  return palette.data;
}

// Get the canvas size from the server. It does not change, so it is loaded once.
export async function getCanvasSize(): Promise<CanvasSize> {
  const response = await fetch('/api/canvas/size');
  if (!response.ok) throw new Error('Could not load the canvas size');
  const size = CanvasSizeSchema.safeParse(await response.json());
  if (!size.success) {
    throw new Error(`The canvas size from the server is invalid: ${formatError(size.error)}`);
  }
  return size.data;
}

// Get all painted pixels of the canvas from the server
export async function getCanvas(): Promise<CanvasState> {
  const response = await fetch('/api/canvas');
  if (!response.ok) throw new Error('Could not load the canvas');
  const state = CanvasStateSchema.safeParse(await response.json());
  if (!state.success) {
    throw new Error(`The canvas from the server is invalid: ${formatError(state.error)}`);
  }
  return state.data;
}

// Save one pixel on the server (colorIndex = palette color id)
export async function placePixel(x: number, y: number, colorIndex: number) {
  const response = await fetch('/api/pixels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y, colorIndex } satisfies PlacePixelRequest),
  });
  if (!response.ok) throw new Error('Could not place the pixel');
}
