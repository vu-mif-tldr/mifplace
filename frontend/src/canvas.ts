// Vieno pikselio dydis: 800x600 canvas tampa 80x60 langelių
export const PIXEL_SIZE = 10;

// Nudažo langelį, ant kurio paspausta, nurodyta spalva
export function paintPixel(canvas: HTMLCanvasElement, color: string, event: MouseEvent) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Kuriame langelyje paspausta (offsetX/offsetY - vieta canvas viduje)
  const column = Math.floor(event.offsetX / PIXEL_SIZE);
  const row = Math.floor(event.offsetY / PIXEL_SIZE);

  // Nudažom tą langelį pasirinkta spalva
  ctx.fillStyle = color;
  ctx.fillRect(column * PIXEL_SIZE, row * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
}
