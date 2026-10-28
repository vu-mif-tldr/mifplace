import type { CanvasState, PlacePixelRequest } from '@mifplace/shared';

// Get the whole canvas from the server
export async function getCanvas(): Promise<CanvasState> {
  const response = await fetch('/api/canvas');
  if (!response.ok) throw new Error('Could not load the canvas');
  return response.json();
}

// Save one pixel on the server (colorIndex = index in PALETTE)
export async function placePixel(x: number, y: number, colorIndex: number) {
  const response = await fetch('/api/pixels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y, colorIndex } satisfies PlacePixelRequest),
  });
  if (!response.ok) throw new Error('Could not place the pixel');
}
