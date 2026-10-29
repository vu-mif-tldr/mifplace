// PNG and palette files for the canvas, used by seed-png.ts and export-palette.ts.
// Kept apart from the scripts so it can be tested without a database.
import pngjs from 'pngjs';
import type { CanvasSize, PaletteColor } from '@mifplace/shared';

export interface CanvasPixel {
  color_id: number;
  position: number;
}

export interface RGBAImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

// The palette as a .hex file (one rrggbb per line, as on Lospec), in color id order.
// Online pixel art editors (e.g. https://tezumie.github.io/Image-to-Pixel/) import it.
export function paletteToHex(palette: PaletteColor[]): string {
  return (
    [...palette]
      .sort((a, b) => a.id - b.id)
      .map((c) => c.color.slice(1).toLowerCase())
      .join('\n') + '\n'
  );
}

// PNG bytes to RGBA pixels (indexed PNGs too)
export function decodePng(bytes: Buffer): RGBAImage {
  return pngjs.PNG.sync.read(bytes);
}

// One pixel per non-transparent pixel of the image, from the top left corner of the canvas.
// position = y * canvas.width + x, as in the events table. The part of a larger image outside
// the canvas is skipped, its colors are not checked. Every other color must be exactly
// a palette color: the image is not converted, prepare it with the palette from export-palette.
export function toCanvasPixels(
  image: RGBAImage,
  palette: PaletteColor[],
  canvas: CanvasSize
): CanvasPixel[] {
  const ids = new Map(palette.map((c) => [c.color.toLowerCase(), c.id]));
  const pixels: CanvasPixel[] = [];
  for (let y = 0; y < Math.min(image.height, canvas.height); y++) {
    for (let x = 0; x < Math.min(image.width, canvas.width); x++) {
      const i = (y * image.width + x) * 4;
      if (image.data[i + 3] === 0) continue; // transparent
      const hex =
        '#' + [0, 1, 2].map((c) => image.data[i + c].toString(16).padStart(2, '0')).join('');
      const id = ids.get(hex);
      if (id === undefined) throw new Error(`Color ${hex} at ${x},${y} is not in the palette`);
      pixels.push({ color_id: id, position: y * canvas.width + x });
    }
  }
  return pixels;
}
