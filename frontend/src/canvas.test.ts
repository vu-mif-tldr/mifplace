import { paintPixel } from './canvas';
import { PALETTE } from './palette';

function fakeCanvas() {
  const ctx = { fillStyle: '', fillRect: vi.fn() };
  const canvas = { getContext: vi.fn(() => ctx) } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
}

const click = (offsetX: number, offsetY: number) => ({ offsetX, offsetY }) as MouseEvent;

describe('paintPixel', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fills the cell under the click with the chosen colour', async () => {
    const { canvas, ctx } = fakeCanvas();

    await paintPixel(canvas, PALETTE[5], click(25, 37));

    expect(ctx.fillStyle).toBe(PALETTE[5]);
    expect(ctx.fillRect).toHaveBeenCalledWith(20, 30, 10, 10);
  });

  it('posts the cell and the palette index to the API', async () => {
    const { canvas } = fakeCanvas();

    await paintPixel(canvas, PALETTE[5], click(25, 37));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/pixels$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ x: 2, y: 3, colorIndex: 5 });
  });

  it('logs an error when the server rejects the pixel', async () => {
    const { canvas } = fakeCanvas();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 400 });

    await paintPixel(canvas, PALETTE[0], click(0, 0));

    expect(error).toHaveBeenCalledOnce();
  });

  it('logs an error when the request fails', async () => {
    const { canvas } = fakeCanvas();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error('network down'));

    await paintPixel(canvas, PALETTE[0], click(0, 0));

    expect(error).toHaveBeenCalledOnce();
  });

  it('does nothing when the canvas has no 2d context', async () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;

    await paintPixel(canvas, PALETTE[0], click(0, 0));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
