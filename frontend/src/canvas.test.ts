import { drawCanvas, getClickedCell, paintCell } from './canvas';
import { PALETTE } from './palette';

function fakeCanvas() {
  const ctx = { fillStyle: '', fillRect: vi.fn() };
  const canvas = {
    width: 640,
    height: 640,
    getContext: vi.fn(() => ctx),
  } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
}

const noContextCanvas = () => ({ getContext: () => null }) as unknown as HTMLCanvasElement;

const click = (offsetX: number, offsetY: number) => ({ offsetX, offsetY }) as MouseEvent;

describe('getClickedCell', () => {
  it('turns the click position into a cell (5x5 px each)', () => {
    expect(getClickedCell(click(12, 7))).toEqual({ x: 2, y: 1 });
  });

  it('keeps clicks on a cell edge in that cell', () => {
    expect(getClickedCell(click(0, 4.9))).toEqual({ x: 0, y: 0 });
    expect(getClickedCell(click(5, 5))).toEqual({ x: 1, y: 1 });
  });
});

describe('paintCell', () => {
  it('fills the cell with the given colour', () => {
    const { canvas, ctx } = fakeCanvas();

    paintCell(canvas, 2, 3, PALETTE[5]);

    expect(ctx.fillStyle).toBe(PALETTE[5]);
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 15, 5, 5);
  });

  it('does nothing when the canvas has no 2d context', () => {
    expect(() => paintCell(noContextCanvas(), 0, 0, PALETTE[0])).not.toThrow();
  });
});

describe('drawCanvas', () => {
  it('paints a white background, then every pixel from the server', () => {
    const { canvas, ctx } = fakeCanvas();

    // position = y * width + x, so 130 is x = 2, y = 1 on a 128-wide canvas
    drawCanvas(canvas, {
      width: 128,
      height: 128,
      pixels: [
        [0, 3],
        [130, 5],
      ],
    });

    expect(ctx.fillRect.mock.calls).toEqual([
      [0, 0, 640, 640],
      [0, 0, 5, 5],
      [10, 5, 5, 5],
    ]);
    expect(ctx.fillStyle).toBe(PALETTE[5]);
  });

  it('leaves only the white background when nothing is painted', () => {
    const { canvas, ctx } = fakeCanvas();

    drawCanvas(canvas, { width: 128, height: 128, pixels: [] });

    expect(ctx.fillRect).toHaveBeenCalledOnce();
    expect(ctx.fillStyle).toBe('#ffffff');
  });

  it('does nothing when the canvas has no 2d context', () => {
    const state = { width: 128, height: 128, pixels: [[0, 3]] as [number, number][] };

    expect(() => drawCanvas(noContextCanvas(), state)).not.toThrow();
  });
});
