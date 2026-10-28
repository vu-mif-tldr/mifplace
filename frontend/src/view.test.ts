import { clampOffset, fitCellSize } from './view';

describe('fitCellSize', () => {
  it('keeps 5 px per cell for the default 128x128 canvas in 640 px', () => {
    expect(fitCellSize({ width: 128, height: 128 }, 640, 640)).toBe(5);
  });

  it('fits the longer side of a non-square canvas', () => {
    expect(fitCellSize({ width: 200, height: 100 }, 640, 640)).toBe(3.2);
    expect(fitCellSize({ width: 100, height: 200 }, 640, 640)).toBe(3.2);
    expect(fitCellSize({ width: 1000, height: 500 }, 640, 640)).toBe(0.64);
  });

  it('scales a small canvas up', () => {
    expect(fitCellSize({ width: 32, height: 32 }, 640, 640)).toBe(20);
  });
});

describe('clampOffset', () => {
  it('centers a canvas shorter than the viewport, whatever the offset', () => {
    expect(clampOffset(0, 320, 640)).toBe(160);
    expect(clampOffset(-500, 320, 640)).toBe(160);
    expect(clampOffset(500, 320, 640)).toBe(160);
  });

  it('keeps a canvas of the viewport size in place', () => {
    expect(clampOffset(-10, 640, 640)).toBe(0);
  });

  it('lets a longer canvas move only until its edge reaches the viewport edge', () => {
    expect(clampOffset(-100, 1280, 640)).toBe(-100);
    expect(clampOffset(50, 1280, 640)).toBe(0);
    expect(clampOffset(-1000, 1280, 640)).toBe(-640);
  });
});
