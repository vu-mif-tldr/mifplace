// Vieno pikselio dydis: 800x600 canvas tampa 80x60 langelių

export const PIXEL_SIZE = 10;

// Nudažo langelį, ant kurio paspausta, nurodyta spalva
export async function paintPixel(canvas: HTMLCanvasElement, color: string, event: MouseEvent) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Kuriame langelyje paspausta (offsetX/offsetY - vieta canvas viduje)
  const column = Math.floor(event.offsetX / PIXEL_SIZE);
  const row = Math.floor(event.offsetY / PIXEL_SIZE);

  // Nudažom tą langelį pasirinkta spalva
  ctx.fillStyle = color;
  ctx.fillRect(column * PIXEL_SIZE, row * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);

  // used for getting data from browser so the post method in server.ts could validate and upload to database.
  try {
    await fetch(`${'http://127.0.0.1:3000'}/api/pixels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ x: column, y: row, color }),
    });
  } catch (err) {
    console.error('Failed to save pixel:', err);
  }
}
