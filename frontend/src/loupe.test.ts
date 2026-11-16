import {
  LOUPE_MIDDLE_PX,
  LOUPE_REACH,
  LOUPE_SIDE,
  drawLens,
  hexRgb,
  lensArea,
  lensOffset,
  loupeCell,
  loupePlace,
} from './loupe';

const radius = LOUPE_SIDE / 2;
const size = { width: 128, height: 128 };

describe('loupePlace', () => {
  // The ring around 5 px cells is 34 px: the loupe stays 8 px clear of it
  it('puts the loupe above the ring, clear of it', () => {
    expect(loupePlace({ x: 300, y: 400 }, 5, 640, 640)).toEqual({ x: 300, y: 400 - 25 - radius });
  });

  it('puts it below when there is no room above', () => {
    expect(loupePlace({ x: 300, y: 100 }, 5, 640, 640)).toEqual({ x: 300, y: 100 + 25 + radius });
  });

  it('keeps it inside the viewport at the sides', () => {
    expect(loupePlace({ x: 10, y: 400 }, 5, 640, 640).x).toBe(radius + 8);
    expect(loupePlace({ x: 635, y: 400 }, 5, 640, 640).x).toBe(640 - radius - 8);
    expect(loupePlace({ x: 10, y: 400 }, 5, 150, 640).x).toBe(75);
  });
});

describe('lensOffset', () => {
  it('looks at the middle of the selected cell from the middle of the lens', () => {
    expect(lensOffset(radius, radius)).toEqual({ x: 0, y: 0, pxPerCell: LOUPE_MIDDLE_PX });
    expect(LOUPE_MIDDLE_PX).toBeCloseTo(19.3, 1);
  });

  it('reaches LOUPE_REACH cells at the rim, and nothing past it', () => {
    expect(lensOffset(LOUPE_SIDE, radius)?.x).toBeCloseTo(LOUPE_REACH);
    expect(lensOffset(radius, 0)?.y).toBeCloseTo(-LOUPE_REACH);
    expect(lensOffset(0, 0)).toBeNull();
  });

  it('magnifies the middle most, like a real lens', () => {
    const near = lensOffset(radius + 8, radius)!;
    const far = lensOffset(radius + 80, radius)!;
    expect(near.pxPerCell).toBeGreaterThan(far.pxPerCell * 1.8);
    // 8 px from the middle is still inside the selected cell; 80 px is 5 cells away
    expect(near.x).toBeLessThan(0.5);
    expect(far.x).toBeGreaterThan(5);
  });
});

describe('loupeCell', () => {
  it('finds the cell under a point of the lens', () => {
    expect(loupeCell({ x: 64, y: 72 }, radius, radius, size)).toEqual({ x: 64, y: 72 });
    // One middle cell (19.3 px) to the right and up
    expect(loupeCell({ x: 64, y: 72 }, radius + 24, radius - 24, size)).toEqual({ x: 65, y: 71 });
  });

  it('finds nothing off the canvas or outside the lens', () => {
    expect(loupeCell({ x: 0, y: 0 }, 10, radius, size)).toBeNull();
    expect(loupeCell({ x: 64, y: 72 }, 2, 2, size)).toBeNull();
  });
});

describe('lensArea', () => {
  it('covers every cell the lens can show', () => {
    expect(lensArea({ x: 64, y: 72 })).toEqual({ x: 57, y: 65, width: 15, height: 15 });
  });
});

describe('hexRgb', () => {
  it('reads #rrggbb only', () => {
    expect(hexRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexRgb('red')).toBeNull();
    expect(hexRgb(undefined)).toBeNull();
  });
});

describe('drawLens', () => {
  const center = { x: 64, y: 72 };
  const area = lensArea(center);
  // Every cell of the area green, the one right of the selected cell blue
  const data = new Uint8ClampedArray(area.width * area.height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([0, 200, 0, 255], i);
  data.set([0, 0, 255, 255], ((center.y - area.y) * area.width + center.x + 1 - area.x) * 4);
  const source = { x: area.x, y: area.y, width: area.width, data };

  function lens(pixel: string | undefined, hovered: { x: number; y: number } | null = null) {
    const out = new Uint8ClampedArray(LOUPE_SIDE * LOUPE_SIDE * 4);
    drawLens(out, LOUPE_SIDE, source, center, pixel, hovered);
    return (px: number, py: number) => [...out.slice((py * LOUPE_SIDE + px) * 4).slice(0, 4)];
  }

  it('draws the coming pixel in the middle, framed white inside its cell', () => {
    const at = lens('#ff0000');
    expect(at(radius, radius)).toEqual([255, 0, 0, 255]);
    // 7.5 px from the middle: in the frame, 1 to 3 px inside the edge of the 19.3 px cell
    expect(at(radius + 7, radius)).toEqual([255, 255, 255, 255]);
  });

  it('draws the cells around through the lens', () => {
    const at = lens('#ff0000');
    expect(at(radius + 24, radius)).toEqual([0, 0, 255, 255]);
    expect(at(radius, radius + 24)).toEqual([0, 200, 0, 255]);
    // Outside the circle: transparent
    expect(at(0, 0)[3]).toBe(0);
  });

  it('shows the cell as it is without a colour, and frames the hovered one', () => {
    expect(lens(undefined)(radius, radius)).toEqual([0, 200, 0, 255]);
    // Near the left edge of the blue cell
    const edge = lens(undefined, { x: 65, y: 72 })(radius + 10, radius);
    expect(edge[2]).toBeGreaterThan(240);
    expect(edge[0]).toBeGreaterThan(200);
  });

  it('leaves cells off the canvas empty', () => {
    const empty = { ...source, data: new Uint8ClampedArray(data.length) };
    const out = new Uint8ClampedArray(LOUPE_SIDE * LOUPE_SIDE * 4);
    drawLens(out, LOUPE_SIDE, empty, center, undefined, null);
    expect([...out.slice((radius * LOUPE_SIDE + radius + 40) * 4).slice(0, 3)]).toEqual([
      12, 16, 48,
    ]);
  });
});
