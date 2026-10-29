import { describe, expect, test } from 'vitest';
import pngjs from 'pngjs';
import type { PaletteColor } from '@mifplace/shared';
import { decodePng, paletteToHex, toCanvasPixels } from './png-canvas.js';

const PALETTE: PaletteColor[] = [
  { id: 9, color: '#FFFFFF' },
  { id: 0, color: '#000000' },
  { id: 5, color: '#ED1C24' },
];

// width x height RGBA image, every pixel from color(x, y)
function image(width: number, height: number, color: (x: number, y: number) => number[]) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(color(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

describe('paletteToHex', () => {
  test('one lowercase rrggbb per line, in id order', () => {
    expect(paletteToHex(PALETTE)).toBe('000000\ned1c24\nffffff\n');
  });
});

describe('decodePng', () => {
  test('reads the pixels of a PNG', () => {
    const png = new pngjs.PNG({ width: 2, height: 1 });
    png.data.set([255, 0, 0, 255, 0, 0, 255, 0]);
    const decoded = decodePng(pngjs.PNG.sync.write(png));
    expect([decoded.width, decoded.height]).toEqual([2, 1]);
    expect(Array.from(decoded.data)).toEqual([255, 0, 0, 255, 0, 0, 255, 0]);
  });
});

describe('toCanvasPixels', () => {
  const picture = image(2, 2, (x, y) =>
    x === 1 && y === 1 ? [0, 0, 0, 0] : x === 0 ? [0xed, 0x1c, 0x24, 255] : [255, 255, 255, 255]
  );

  test('maps colors to palette ids from the top left corner, skips transparent pixels', () => {
    expect(toCanvasPixels(picture, PALETTE, { width: 10, height: 10 })).toEqual([
      { color_id: 5, position: 0 },
      { color_id: 9, position: 1 },
      { color_id: 5, position: 10 },
    ]);
  });

  test('keeps only the part of a larger picture that fits the canvas', () => {
    expect(toCanvasPixels(picture, PALETTE, { width: 1, height: 10 })).toEqual([
      { color_id: 5, position: 0 },
      { color_id: 5, position: 1 },
    ]);
    expect(toCanvasPixels(picture, PALETTE, { width: 10, height: 1 })).toEqual([
      { color_id: 5, position: 0 },
      { color_id: 9, position: 1 },
    ]);
  });

  test('does not check colors outside the canvas', () => {
    const greenEdge = image(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [0, 255, 0, 255]));
    expect(toCanvasPixels(greenEdge, PALETTE, { width: 1, height: 1 })).toEqual([
      { color_id: 0, position: 0 },
    ]);
  });

  test('rejects a color outside the palette', () => {
    const green = image(1, 1, () => [0, 255, 0, 255]);
    expect(() => toCanvasPixels(green, PALETTE, { width: 10, height: 10 })).toThrow(
      /#00ff00 at 0,0/
    );
  });
});
