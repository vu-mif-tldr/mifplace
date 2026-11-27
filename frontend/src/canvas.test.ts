import { drawCanvas, paintCell, showCanvas } from './canvas';

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

// A canvas element that records what is drawn on it
function recordingCanvas() {
  const ctx = {
    fillStyle: '',
    imageSmoothingEnabled: true,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };
  const canvas = { width: 300, height: 150, getContext: vi.fn(() => ctx) };
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx };
}

describe('showCanvas', () => {
  const size = { width: 128, height: 128 };
  const source = { width: 128, height: 128 } as HTMLCanvasElement;
  const view = { width: 800.4, height: 600, x: 80.5, y: -10, cellPx: 3.5, pixelRatio: 2 };

  it('fills the viewport in screen pixels and draws the cells there without smoothing', () => {
    const { canvas, ctx } = recordingCanvas();

    showCanvas(canvas, source, size, view);

    expect(canvas.width).toBe(1601);
    expect(canvas.height).toBe(1200);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1601, 1200);
    expect(ctx.imageSmoothingEnabled).toBe(false);
    // 7 screen pixels per cell, the canvas starts at 161, -20 screen pixels
    expect(ctx.setTransform).toHaveBeenLastCalledWith(7, 0, 0, 7, 161, -20);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 128, 128);
    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0);
  });

  it('keeps the size of the element while it fits, so it is not reset on every frame', () => {
    const { canvas } = recordingCanvas();
    showCanvas(canvas, source, size, view);
    const widthSetter = vi.fn();
    Object.defineProperty(canvas, 'width', { get: () => 1601, set: widthSetter });

    showCanvas(canvas, source, size, { ...view, x: 0 });

    expect(widthSetter).not.toHaveBeenCalled();
  });

  it('shows only the white background until a snapshot is drawn on the source', () => {
    const { canvas, ctx } = recordingCanvas();

    showCanvas(canvas, { width: 300, height: 150 } as HTMLCanvasElement, size, view);

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 128, 128);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('does nothing when the canvas has no 2d context', () => {
    expect(() => showCanvas(noContextCanvas(), source, size, view)).not.toThrow();
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
