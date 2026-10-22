import { getCanvas, placePixel } from './api';

describe('api', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getCanvas', () => {
    it('returns the canvas from GET /api/canvas', async () => {
      const state = { width: 128, height: 128, pixels: [[130, 5]] };
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => state });

      await expect(getCanvas()).resolves.toEqual(state);
      expect(fetchMock).toHaveBeenCalledWith('/api/canvas');
    });

    it('throws when the server answers with an error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });

      await expect(getCanvas()).rejects.toThrow();
    });
  });

  describe('placePixel', () => {
    it('posts the cell and the palette index to /api/pixels', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });

      await placePixel(2, 3, 5);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/pixels');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(init.body)).toEqual({ x: 2, y: 3, colorIndex: 5 });
    });

    it('throws when the server rejects the pixel', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 400 });

      await expect(placePixel(0, 0, 0)).rejects.toThrow();
    });

    it('lets network errors through to the caller', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(placePixel(0, 0, 0)).rejects.toThrow('network down');
    });
  });
});
