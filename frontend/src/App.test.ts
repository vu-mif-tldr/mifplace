// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import App from './App.vue';
import { getCanvas, getCanvasSize, getPalette, placePixel } from './api';
import { connectLive, type LiveHandlers } from './live';
import { NEUTRAL_GLOW } from './glow';
import { texts } from './texts';
import ActivityTicker from './components/ActivityTicker.vue';
import CanvasView from './components/CanvasView.vue';
import LoadState from './components/LoadState.vue';
import PaletteDock from './components/PaletteDock.vue';
import SelectionRing from './components/SelectionRing.vue';
import TopBar from './components/TopBar.vue';
import TopLights from './components/TopLights.vue';

// The page against a fake server: the API calls and the live connection are mocked
vi.mock('./api', () => ({
  getPalette: vi.fn(),
  getCanvasSize: vi.fn(),
  getCanvas: vi.fn(),
  placePixel: vi.fn(),
}));
vi.mock('./live', () => ({ connectLive: vi.fn() }));

const palette = [
  { id: 0, color: '#000000' },
  { id: 9, color: '#00A2E8' },
];
const snapshot = { pixels: [-1, -1, -1, -1], eventId: 5, timestamp: 1000 };

let handlers: LiveHandlers;
const close = vi.fn();

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.mocked(getPalette).mockResolvedValue(palette);
  vi.mocked(getCanvasSize).mockResolvedValue({ width: 2, height: 2 });
  vi.mocked(getCanvas).mockResolvedValue(snapshot);
  vi.mocked(placePixel).mockResolvedValue(undefined);
  vi.mocked(connectLive).mockImplementation((_checkpoint, given) => {
    handlers = given;
    given.onState?.('connecting');
    return { checkpoint: _checkpoint, state: 'connecting', close };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function page() {
  const wrapper = mount(App, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

const pick = (wrapper: Awaited<ReturnType<typeof page>>, x: number, y: number) =>
  wrapper.getComponent(CanvasView).vm.$emit('pick', { x, y });

describe('App', () => {
  it('loads the canvas and follows it from the snapshot checkpoint', async () => {
    const wrapper = await page();
    expect(wrapper.findComponent(LoadState).exists()).toBe(false);
    expect(connectLive).toHaveBeenCalledWith({ eventId: 5, timestamp: 1000 }, expect.any(Object));
    expect(wrapper.getComponent(PaletteDock).props('selectedId')).toBe(0);
    wrapper.unmount();
    expect(close).toHaveBeenCalled();
  });

  it('shows the failure and loads again on retry', async () => {
    vi.mocked(getPalette).mockRejectedValueOnce(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = await page();
    const state = wrapper.getComponent(LoadState);
    expect(state.props('failed')).toBe(true);

    await state.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(LoadState).exists()).toBe(false);
    wrapper.unmount();
  });

  it('picks a cell with one click and places the pixel with a second', async () => {
    const wrapper = await page();
    await wrapper.getComponent(PaletteDock).vm.$emit('select', palette[1]);
    await pick(wrapper, 1, 1);
    expect(wrapper.getComponent(SelectionRing).props('label')).toBe('1, 1');
    expect(placePixel).not.toHaveBeenCalled();

    await pick(wrapper, 1, 1);
    await flushPromises();
    // pos = y * width + x, and the palette id, not the index
    expect(placePixel).toHaveBeenCalledWith(3, 9);
    wrapper.unmount();
  });

  it('places with Enter and lets go of the cell with Escape', async () => {
    const wrapper = await page();
    await pick(wrapper, 0, 1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flushPromises();
    expect(placePixel).toHaveBeenCalledWith(2, 0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.findComponent(SelectionRing).exists()).toBe(false);
    wrapper.unmount();
  });

  it('lets go of the cell on a click beside the canvas', async () => {
    const wrapper = await page();
    await pick(wrapper, 0, 1);
    expect(wrapper.findComponent(SelectionRing).exists()).toBe(true);
    // happy-dom measures nothing: the 2x2 canvas is 1 px per cell from the viewport corner,
    // so 5, 5 is beside it
    await wrapper.get('canvas.canvas').trigger('click', { clientX: 5, clientY: 5 });
    expect(wrapper.findComponent(SelectionRing).exists()).toBe(false);
    wrapper.unmount();
  });

  it('tells when the pixel was not placed', async () => {
    vi.mocked(placePixel).mockRejectedValueOnce(new Error('400'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = await page();
    await pick(wrapper, 0, 0);
    await pick(wrapper, 0, 0);
    await flushPromises();
    expect(wrapper.getComponent(PaletteDock).props('error')).toBe(texts.placeFailed);
    wrapper.unmount();
  });

  it('blooms where live pixels arrive and dims while reconnecting', async () => {
    const wrapper = await page();
    handlers.onPixels([
      { pos: 1, colorId: 9 },
      { pos: 2, colorId: -1 },
    ]);
    handlers.onState?.('reconnecting');
    await flushPromises();
    const view = wrapper.getComponent(CanvasView);
    expect(view.props('blooms')).toMatchObject([{ x: 1, y: 0, color: '#00a2e8' }]);
    expect(view.props('paused')).toBe(true);
    wrapper.unmount();
  });

  it('shows how many pages are open only while connected', async () => {
    const wrapper = await page();
    const bar = wrapper.getComponent(TopBar);
    handlers.onOnline?.(5);
    await flushPromises();
    // Still connecting: no count yet
    expect(bar.props('online')).toBeNull();

    handlers.onState?.('connected');
    await flushPromises();
    expect(bar.props('online')).toBe(5);

    handlers.onState?.('reconnecting');
    await flushPromises();
    expect(bar.props('online')).toBeNull();
    wrapper.unmount();
  });

  it('lights the page from the top in the colours of live pixels', async () => {
    const wrapper = await page();
    handlers.onPixels([
      { pos: 1, colorId: 9 },
      { pos: 2, colorId: 0 },
    ]);
    await flushPromises();
    // Black shines in the neutral light, as its bloom does
    expect(wrapper.getComponent(TopLights).props('lights')).toMatchObject([
      { color: '#00a2e8' },
      { color: NEUTRAL_GLOW },
    ]);
    wrapper.unmount();
  });

  it('announces live pixels in the ticker, in their real colour', async () => {
    const wrapper = await page();
    handlers.onPixels([
      { pos: 0, colorId: 9 },
      { pos: 1, colorId: 0 },
    ]);
    await flushPromises();
    const ticker = wrapper.getComponent(ActivityTicker);
    const items = ticker.findAll('li');
    expect(items.map((li) => li.text())).toEqual(['+1', '+1']);
    // Black stays black here; only its bloom on the canvas is the neutral light
    expect(items[1].get('.dot').attributes('style')).toContain('background: #000000');
    wrapper.unmount();
  });
});
