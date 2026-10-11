import { describe, expect, it } from 'vitest';
import { fitScale, hexToRgb } from './canvas';

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
