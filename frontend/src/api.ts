// Canvas as sent by the backend.
// pixels holds only painted cells: [position, colorId], where position = y * width + x
export type CanvasState = {
  width: number;
  height: number;
  pixels: [number, number][];
};

// Fetch the whole canvas
export async function getCanvas(): Promise<CanvasState> {
  const response = await fetch('/api/canvas');
  if (!response.ok) {
    throw new Error(`GET /api/canvas: ${response.status}`);
  }
  return response.json();
}

// Send a new pixel (colorIndex = index in PALETTE)
export async function placePixel(x: number, y: number, colorIndex: number): Promise<void> {
  const response = await fetch('/api/pixels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y, colorIndex }),
  });
  if (!response.ok) {
    throw new Error(`POST /api/pixels: ${response.status}`);
  }
}
