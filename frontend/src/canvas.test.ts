import { describe, expect, it } from 'vitest';
import { EMPTY_CELL, parseCanvas } from './api';
import { fillRgba, fitScale, hexToRgb } from './canvas';

describe('parseCanvas', () => {
  // The layout written by CanvasState on the backend: width, height (u32 LE), then the cells.
  function body(width: number, height: number, cells: number[]): ArrayBuffer {
    const bytes = new Uint8Array(8 + cells.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, width, true);
    view.setUint32(4, height, true);
    bytes.set(cells, 8);
    return bytes.buffer;
  }

  it('reads the size and the cells', () => {
    const snap = parseCanvas(body(3, 2, [0, EMPTY_CELL, 2, 3, 4, 5]));
    expect(snap.width).toBe(3);
    expect(snap.height).toBe(2);
    expect([...snap.cells]).toEqual([0, EMPTY_CELL, 2, 3, 4, 5]);
  });

  it('rejects a body that does not match the size', () => {
    expect(() => parseCanvas(body(3, 2, [0, 1, 2]))).toThrow(/3 cells, expected 3x2/);
    expect(() => parseCanvas(new ArrayBuffer(4))).toThrow(/too short/);
  });
});

describe('fillRgba', () => {
  it('paints known colors, empty and unknown cells get the background', () => {
    const palette = [
      { id: 0, rgb: '#000000' },
      { id: 2, rgb: '#FF0000' },
    ];
    const rgba = new Uint8ClampedArray(4 * 4);
    const unknown = fillRgba(rgba, palette, new Uint8Array([0, EMPTY_CELL, 2, 7]));
    expect(unknown).toBe(1);
    expect([...rgba]).toEqual([
      ...[0, 0, 0, 255],
      ...[255, 255, 255, 255],
      ...[255, 0, 0, 255],
      ...[255, 255, 255, 255],
    ]);
  });
});

describe('hexToRgb', () => {
  it('splits #RRGGBB into channels', () => {
    expect(hexToRgb('#FF8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
  });
});

describe('fitScale', () => {
  it('is limited by the shorter side of the window', () => {
    // 256 cells: 1000 px of height gives 3x (3 * 256 + border fits, 4x does not).
    expect(fitScale(256, 256, 1600, 1000)).toBe(3);
    expect(fitScale(256, 256, 1000, 1600)).toBe(3);
  });

  it('keeps the border inside the window', () => {
    expect(fitScale(256, 256, 770, 770)).toBe(3); // 3 * 256 + 2 = 770 fits exactly
    expect(fitScale(256, 256, 769, 769)).toBe(2);
  });

  it('stays within the allowed range', () => {
    expect(fitScale(256, 256, 100, 100)).toBe(1);
    expect(fitScale(16, 16, 5000, 5000)).toBe(20);
  });
});
