import { drawCanvas, getClickedCell, paintCell } from './canvas';

// Ids have a gap on purpose: colors must be looked up by id, not by index
const palette = [
  { id: 3, color: '#ff0000' },
  { id: 7, color: '#00ff00' },
];

function fakeCanvas() {
  const ctx = { fillStyle: '', fillRect: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
  } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
}

const noContextCanvas = () => ({ getContext: () => null }) as unknown as HTMLCanvasElement;

// A click on a canvas shown at left, top with the given on-screen size
function click(
  clientX: number,
  clientY: number,
  rect = { left: 0, top: 0, width: 640, height: 640 }
) {
  const currentTarget = { getBoundingClientRect: () => rect };
  return { clientX, clientY, currentTarget } as unknown as MouseEvent;
}

describe('getClickedCell', () => {
  const size = { width: 128, height: 128 };

  it('turns the click position into a cell (5x5 px each on a 640 px canvas)', () => {
    expect(getClickedCell(click(12, 7), size)).toEqual({ x: 2, y: 1 });
  });

  it('keeps clicks on a cell edge in that cell', () => {
    expect(getClickedCell(click(0, 4.9), size)).toEqual({ x: 0, y: 0 });
    expect(getClickedCell(click(5, 5), size)).toEqual({ x: 1, y: 1 });
  });

  it('takes the canvas position and zoom into account', () => {
    // Zoomed in 4 times (20 px per cell) and moved, the canvas starts at 100, 50
    const rect = { left: 100, top: 50, width: 2560, height: 2560 };
    expect(getClickedCell(click(100 + 20 * 7 + 19, 50 + 20 * 3, rect), size)).toEqual({
      x: 7,
      y: 3,
    });
  });

  it('works for a non-square canvas', () => {
    // 200x100 cells shown as 640x320 px, 3.2 px per cell
    const rect = { left: 0, top: 0, width: 640, height: 320 };
    expect(getClickedCell(click(639, 319, rect), { width: 200, height: 100 })).toEqual({
      x: 199,
      y: 99,
    });
    expect(getClickedCell(click(3.3, 3.1, rect), { width: 200, height: 100 })).toEqual({
      x: 1,
      y: 0,
    });
  });

  it('keeps a click on the far edge in the last cell', () => {
    expect(getClickedCell(click(640, 640), size)).toEqual({ x: 127, y: 127 });
  });
});

describe('paintCell', () => {
  it('fills the cell with the given colour', () => {
    const { canvas, ctx } = fakeCanvas();

    paintCell(canvas, 2, 3, '#ff0000');

    expect(ctx.fillStyle).toBe('#ff0000');
    expect(ctx.fillRect).toHaveBeenCalledWith(2, 3, 1, 1);
  });

  it('does nothing when the canvas has no 2d context', () => {
    expect(() => paintCell(noContextCanvas(), 0, 0, '#ff0000')).not.toThrow();
  });
});

describe('drawCanvas', () => {
  const size = { width: 4, height: 3 };
  const _ = -1;

  // A snapshot of GET /api/canvas with the given color ids, index = position
  const snapshot = (pixels: number[]) => ({ pixels, eventId: 1, timestamp: 1000 });

  it('paints a white background, then every painted cell from the server', () => {
    const { canvas, ctx } = fakeCanvas();

    // position = y * width + x, so 6 is x = 2, y = 1 on a 4-wide canvas
    // prettier-ignore
    drawCanvas(canvas, size, snapshot([
      3, _, _, _,
      _, _, 7, _,
      _, _, _, _,
    ]), palette);

    expect(ctx.fillRect.mock.calls).toEqual([
      [0, 0, 4, 3],
      [0, 0, 1, 1],
      [2, 1, 1, 1],
    ]);
    expect(ctx.fillStyle).toBe('#00ff00');
  });

  it('sizes the canvas element from the server size, one pixel per cell', () => {
    const { canvas, ctx } = fakeCanvas();
    const pixels = Array<number>(200 * 100).fill(_);
    // position 250 is x = 50, y = 1 on a 200-wide canvas
    pixels[250] = 3;

    drawCanvas(canvas, { width: 200, height: 100 }, snapshot(pixels), palette);

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(ctx.fillRect.mock.calls).toEqual([
      [0, 0, 200, 100],
      [50, 1, 1, 1],
    ]);
  });

  it('leaves only the white background when nothing is painted', () => {
    const { canvas, ctx } = fakeCanvas();

    drawCanvas(canvas, size, snapshot(Array(12).fill(_)), palette);

    expect(ctx.fillRect).toHaveBeenCalledOnce();
    expect(ctx.fillStyle).toBe('#ffffff');
  });

  it('skips unpainted (any negative) and unknown color ids', () => {
    const { canvas, ctx } = fakeCanvas();

    drawCanvas(canvas, size, snapshot([-1, -2, 99, ...Array(9).fill(_)]), palette);

    expect(ctx.fillRect).toHaveBeenCalledOnce();
    expect(ctx.fillStyle).toBe('#ffffff');
  });

  it('throws and draws nothing for a snapshot of another size', () => {
    const { canvas, ctx } = fakeCanvas();

    expect(() => drawCanvas(canvas, size, snapshot(Array(11).fill(3)), palette)).toThrow(
      'The canvas has 11 cells, expected 4x3'
    );
    expect(() => drawCanvas(canvas, size, snapshot(Array(13).fill(3)), palette)).toThrow();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('does nothing when the canvas has no 2d context', () => {
    expect(() =>
      drawCanvas(noContextCanvas(), size, snapshot(Array(12).fill(3)), palette)
    ).not.toThrow();
  });
});
