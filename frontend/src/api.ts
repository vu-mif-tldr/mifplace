import type { CanvasState, PlacePixelRequest } from '@mifplace/shared';

// One color from GET /api/palette. id is the color id the server uses, not an index in the list
export type PaletteColor = {
  id: number;
  color: string;
};

// Get the color palette from the server
export async function getPalette(): Promise<PaletteColor[]> {
  const response = await fetch('/api/palette');
  if (!response.ok) throw new Error('Could not load the palette');
  const palette: unknown = await response.json();
  if (!isValidPalette(palette)) throw new Error('The palette from the server is invalid');
  return palette;
}

// TypeScript types are not checked at runtime, so check the JSON before using it:
// a non-empty list, unique non-negative integer ids (negative means unpainted), #rrggbb colors
function isValidPalette(data: unknown): data is PaletteColor[] {
  if (!Array.isArray(data) || data.length === 0) return false;
  const ids = new Set<number>();
  for (const item of data) {
    if (!Number.isInteger(item?.id) || item.id < 0 || ids.has(item.id)) return false;
    if (typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)) return false;
    ids.add(item.id);
  }
  return true;
}

// Get the whole canvas from the server
export async function getCanvas(): Promise<CanvasState> {
  const response = await fetch('/api/canvas');
  if (!response.ok) throw new Error('Could not load the canvas');
  return response.json();
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
