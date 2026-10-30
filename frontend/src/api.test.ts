import { getCanvas, getCanvasSize, getPalette, placePixel } from './api';

describe('api', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getPalette', () => {
    const palette = [
      { id: 0, color: '#000000' },
      { id: 5, color: '#FFFFFF' },
    ];

    it('returns the palette from GET /api/palette', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => palette });

      await expect(getPalette()).resolves.toEqual(palette);
      expect(fetchMock).toHaveBeenCalledWith('/api/palette');
    });

    it('throws when the server answers with an error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });

      await expect(getPalette()).rejects.toThrow('Could not load the palette');
    });

    it.each([
      ['not a list', { id: 0, color: '#000000' }],
      ['an empty list', []],
      ['a plain list of colors', ['#000000']],
      ['a negative id', [{ id: -1, color: '#000000' }]],
      ['a non-integer id', [{ id: 1.5, color: '#000000' }]],
      [
        'a duplicate id',
        [
          { id: 1, color: '#000000' },
          { id: 1, color: '#ffffff' },
        ],
      ],
      ['a color that is not #rrggbb', [{ id: 0, color: 'red' }]],
    ])('rejects a palette with %s', async (_case, body) => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });

      await expect(getPalette()).rejects.toThrow('The palette from the server is invalid');
    });
  });

  describe('getCanvasSize', () => {
    it('returns the size from GET /api/canvas/size', async () => {
      const size = { width: 128, height: 128 };
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => size });

      await expect(getCanvasSize()).resolves.toEqual(size);
      expect(fetchMock).toHaveBeenCalledWith('/api/canvas/size');
    });

    it('throws when the server answers with an error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });

      await expect(getCanvasSize()).rejects.toThrow();
    });

    it.each([
      ['a zero width', { width: 0, height: 128 }],
      ['a missing height', { width: 128 }],
      ['a string', '128x128'],
    ])('rejects a size with %s', async (_case, body) => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });

      await expect(getCanvasSize()).rejects.toThrow('The canvas size from the server is invalid');
    });
  });

  describe('getCanvas', () => {
    it('returns the canvas from GET /api/canvas', async () => {
      const state = { pixels: [5, 12, -1, -2, 5, -3], eventId: 102, timestamp: 1760000000000 };
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => state });

      await expect(getCanvas()).resolves.toEqual(state);
      expect(fetchMock).toHaveBeenCalledWith('/api/canvas');
    });

    it('throws when the server answers with an error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });

      await expect(getCanvas()).rejects.toThrow();
    });

    it.each([
      ['no pixels list', { eventId: 0, timestamp: 0 }],
      ['no checkpoint', { pixels: [5, -1] }],
      ['the old [position, colorId] pairs', { pixels: [[130, 5]], eventId: 0, timestamp: 0 }],
      ['a negative eventId', { pixels: [5], eventId: -1, timestamp: 0 }],
    ])('rejects a canvas with %s', async (_case, body) => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });

      await expect(getCanvas()).rejects.toThrow('The canvas from the server is invalid');
    });
  });

  describe('placePixel', () => {
    it('posts the position and the palette color id to /api/pixels', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });

      await placePixel(6, 5);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/pixels');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(init.body)).toEqual({ pos: 6, colorIndex: 5 });
    });

    it('throws when the server rejects the pixel', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 400 });

      await expect(placePixel(0, 0)).rejects.toThrow();
    });

    it('lets network errors through to the caller', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(placePixel(0, 0)).rejects.toThrow('network down');
    });
  });
});
