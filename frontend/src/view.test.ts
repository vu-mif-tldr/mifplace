import {
  cellAt,
  cellCenter,
  clampOffset,
  clickAction,
  fitCellSize,
  ringSize,
  visiblePart,
  zoomOffset,
} from './view';

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

describe('zoomOffset', () => {
  it('keeps the spot under the point in place', () => {
    // The canvas starts at 100; the point at 300 is 200 px into it. Twice the zoom: 400 px.
    expect(zoomOffset(100, 300, 1, 2)).toBe(-100);
    expect(zoomOffset(-100, 300, 2, 1)).toBe(100);
  });

  it('does not move the canvas when the zoom stays the same', () => {
    expect(zoomOffset(42, 300, 3, 3)).toBe(42);
  });
});

describe('cellCenter', () => {
  it('is the middle of the cell on screen', () => {
    expect(cellCenter({ x: 0, y: 0 }, { x: 10, y: 20 }, 5)).toEqual({ x: 12.5, y: 22.5 });
    expect(cellCenter({ x: 3, y: 1 }, { x: -100, y: 0 }, 10)).toEqual({ x: -65, y: 15 });
  });
});

describe('cellAt', () => {
  const size = { width: 128, height: 128 };
  const origin = { x: 0, y: 0 };

  it('turns a point into a cell (5x5 px each on a 640 px canvas)', () => {
    expect(cellAt({ x: 12, y: 7 }, origin, 5, size)).toEqual({ x: 2, y: 1 });
  });

  it('keeps points on a cell edge in that cell', () => {
    expect(cellAt({ x: 0, y: 4.9 }, origin, 5, size)).toEqual({ x: 0, y: 0 });
    expect(cellAt({ x: 5, y: 5 }, origin, 5, size)).toEqual({ x: 1, y: 1 });
  });

  it('takes the canvas offset and zoom into account', () => {
    // Zoomed in 4 times (20 px per cell) and moved, the canvas starts at 100, 50
    expect(cellAt({ x: 100 + 20 * 7 + 19, y: 50 + 20 * 3 }, { x: 100, y: 50 }, 20, size)).toEqual({
      x: 7,
      y: 3,
    });
  });

  it('works for a non-square canvas', () => {
    // 200x100 cells shown as 640x320 px, 3.2 px per cell
    const wide = { width: 200, height: 100 };
    expect(cellAt({ x: 639, y: 319 }, origin, 3.2, wide)).toEqual({ x: 199, y: 99 });
    expect(cellAt({ x: 3.3, y: 3.1 }, origin, 3.2, wide)).toEqual({ x: 1, y: 0 });
  });

  it('finds no cell beside the canvas', () => {
    expect(cellAt({ x: 99, y: 60 }, { x: 100, y: 50 }, 5, size)).toBeNull();
    expect(cellAt({ x: 120, y: 49 }, { x: 100, y: 50 }, 5, size)).toBeNull();
    expect(cellAt({ x: 740, y: 60 }, { x: 100, y: 50 }, 5, size)).toBeNull();
    expect(cellAt({ x: 120, y: 690 }, { x: 100, y: 50 }, 5, size)).toBeNull();
  });
});

describe('clickAction', () => {
  it('selects a cell when nothing is selected', () => {
    expect(clickAction(null, { x: 1, y: 2 })).toBe('select');
  });

  it('places on a second click on the same cell', () => {
    expect(clickAction({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe('place');
  });

  it('moves the selection on a click on another cell', () => {
    expect(clickAction({ x: 1, y: 2 }, { x: 2, y: 2 })).toBe('select');
    expect(clickAction({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe('select');
  });
});

describe('visiblePart', () => {
  it('keeps a rectangle that is fully inside', () => {
    expect(visiblePart({ x: 10, y: 10, width: 50, height: 40 }, 100, 100)).toEqual({
      x: 10,
      y: 10,
      width: 50,
      height: 40,
    });
  });

  it('cuts a rectangle larger than the viewport to the viewport', () => {
    expect(visiblePart({ x: -50, y: -20, width: 300, height: 300 }, 100, 80)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });
  });

  it('has zero size when the rectangle is outside', () => {
    const part = visiblePart({ x: 200, y: 0, width: 50, height: 50 }, 100, 100);
    expect(part.width).toBe(0);
  });
});

describe('ringSize', () => {
  it('is at least 34 px and grows with the cells', () => {
    expect(ringSize(5)).toBe(34);
    expect(ringSize(40)).toBe(58);
  });
});
