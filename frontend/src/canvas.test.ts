import { drawCanvas, getClickedCell, paintCell } from './canvas';

// Ids have a gap on purpose: colors must be looked up by id, not by index
const palette = [
  { id: 3, color: '#ff0000' },
  { id: 7, color: '#00ff00' },
];

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

    paintCell(canvas, 2, 3, '#ff0000');

    expect(ctx.fillStyle).toBe('#ff0000');
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 15, 5, 5);
  });

  it('does nothing when the canvas has no 2d context', () => {
    expect(() => paintCell(noContextCanvas(), 0, 0, '#ff0000')).not.toThrow();
  });
});

describe('drawCanvas', () => {
  const size = { width: 128, height: 128 };

  it('paints a white background, then every pixel from the server', () => {
    const { canvas, ctx } = fakeCanvas();

    // position = y * width + x, so 130 is x = 2, y = 1 on a 128-wide canvas
    drawCanvas(
      canvas,
      size,
      {
        pixels: [
          [0, 3],
          [130, 7],
        ],
      },
      palette
    );

    expect(ctx.fillRect.mock.calls).toEqual([
      [0, 0, 640, 640],
      [0, 0, 5, 5],
      [10, 5, 5, 5],
    ]);
    expect(ctx.fillStyle).toBe('#00ff00');
  });

  it('leaves only the white background when nothing is painted', () => {
    const { canvas, ctx } = fakeCanvas();

    drawCanvas(canvas, size, { pixels: [] }, palette);

    expect(ctx.fillRect).toHaveBeenCalledOnce();
    expect(ctx.fillStyle).toBe('#ffffff');
  });

  it('skips unpainted (negative) and unknown color ids', () => {
    const { canvas, ctx } = fakeCanvas();

    const pixels: [number, number][] = [
      [0, -1],
      [1, 99],
    ];
    drawCanvas(canvas, size, { pixels }, palette);

    expect(ctx.fillRect).toHaveBeenCalledOnce();
    expect(ctx.fillStyle).toBe('#ffffff');
  });

  it('does nothing when the canvas has no 2d context', () => {
    const state = { pixels: [[0, 3]] as [number, number][] };

    expect(() => drawCanvas(noContextCanvas(), size, state, palette)).not.toThrow();
  });
});
