// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import CanvasView from './CanvasView.vue';
import CellLoupe from './CellLoupe.vue';
import { LOUPE_MIDDLE_PX } from '../loupe';
import SelectionRing from './SelectionRing.vue';

// happy-dom measures nothing and draws nothing: the viewport size comes from a fake
// ResizeObserver, and the page canvas and the source of the cells get contexts that record
// what is drawn (the loupe gets none, as in happy-dom)
type ResizeCallback = (entries: { contentRect: { width: number; height: number } }[]) => void;
let resizeCallbacks: ResizeCallback[] = [];

class FakeResizeObserver {
  constructor(callback: ResizeCallback) {
    resizeCallbacks.push(callback);
  }
  observe() {}
  disconnect() {}
}

function resize(width: number, height: number) {
  for (const callback of resizeCallbacks) callback([{ contentRect: { width, height } }]);
}

type FakeContext = {
  fillStyle: string;
  imageSmoothingEnabled: boolean;
  setTransform: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};
let contexts = new Map<HTMLCanvasElement, FakeContext>();

function fakeGetContext(this: HTMLCanvasElement) {
  if (this.classList.contains('lens')) return null;
  if (!contexts.has(this)) {
    contexts.set(this, {
      fillStyle: '',
      imageSmoothingEnabled: true,
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    });
  }
  return contexts.get(this);
}

const size = { width: 128, height: 128 };

function canvasView(props: Partial<InstanceType<typeof CanvasView>['$props']> = {}) {
  const wrapper = mount(CanvasView, {
    props: {
      size,
      selectedCell: null,
      selectedColor: '#ff0000',
      blooms: [],
      paused: false,
      ...props,
    },
  });
  const canvas = wrapper.get('canvas');
  // Where the cells are shown last, as a CSS transform (one screen pixel per CSS px here)
  const shown = () => {
    const calls = contexts.get(canvas.element as HTMLCanvasElement)?.setTransform.mock.calls ?? [];
    const [scale, , , , x, y] = calls[calls.length - 1] ?? [];
    return `translate(${x}px, ${y}px) scale(${scale})`;
  };
  return { wrapper, canvas, shown };
}

// A pointer event on an element: the mouse unless a finger is named
type Pointer = { id?: number; type?: 'mouse' | 'touch'; x?: number; y?: number };
function pointer(
  target: { trigger: (event: string, options: object) => Promise<void> },
  event: string,
  { id = 1, type = 'mouse', x = 0, y = 0 }: Pointer = {}
) {
  return target.trigger(event, { pointerId: id, pointerType: type, clientX: x, clientY: y });
}

beforeEach(() => {
  resizeCallbacks = [];
  contexts = new Map();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    fakeGetContext as unknown as HTMLCanvasElement['getContext']
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CanvasView', () => {
  it('fits the whole canvas into the viewport once it knows its size', async () => {
    const { wrapper, shown } = canvasView();
    resize(640, 640);
    await wrapper.vm.$nextTick();
    expect(shown()).toContain('translate(0px, 0px) scale(5)');

    // A wide viewport: the canvas is centred
    resize(1000, 640);
    await wrapper.vm.$nextTick();
    expect(shown()).toContain('translate(180px, 0px) scale(5)');
  });

  it('zooms with the wheel', async () => {
    const { wrapper, shown } = canvasView();
    resize(640, 640);
    await wrapper.get('.viewport').trigger('wheel', { deltaY: -100, clientX: 0, clientY: 0 });
    expect(shown()).toContain('scale(5.5');
  });

  it('reports a clicked cell', async () => {
    const { wrapper, canvas } = canvasView();
    // A 640 px viewport: 5 px per cell
    resize(640, 640);
    await canvas.trigger('click', { clientX: 12, clientY: 7 });
    expect(wrapper.emitted('pick')).toEqual([[{ x: 2, y: 1 }]]);
    // The click on the canvas is not one beside it
    expect(wrapper.emitted('release')).toBeUndefined();
  });

  it('reports a click beside the canvas, but not the end of a drag there', async () => {
    const { wrapper, canvas } = canvasView();
    // The canvas is centred, 180 px from the left edge
    resize(1000, 640);
    const viewport = wrapper.get('.viewport');
    await canvas.trigger('click', { clientX: 50, clientY: 300 });
    expect(wrapper.emitted('release')).toHaveLength(1);
    expect(wrapper.emitted('pick')).toBeUndefined();

    await pointer(viewport, 'pointerdown', { x: 100, y: 100 });
    await pointer(viewport, 'pointermove', { x: 60, y: 100 });
    await pointer(viewport, 'pointerup', { x: 60, y: 100 });
    await canvas.trigger('click', { clientX: 60, clientY: 100 });
    expect(wrapper.emitted('release')).toHaveLength(1);
  });

  it('does not report a click that ends a drag', async () => {
    const { wrapper, canvas, shown } = canvasView();
    resize(640, 640);
    await wrapper.get('.viewport').trigger('wheel', { deltaY: -100, clientX: 0, clientY: 0 });
    const viewport = wrapper.get('.viewport');
    await pointer(viewport, 'pointerdown', { x: 100, y: 100 });
    await pointer(viewport, 'pointermove', { x: 80, y: 100 });
    await pointer(viewport, 'pointerup', { x: 80, y: 100 });
    await canvas.trigger('click', { clientX: 80, clientY: 100 });
    expect(wrapper.emitted('pick')).toBeUndefined();
    // The zoomed canvas moved with the mouse
    expect(shown()).toContain('translate(-20px, 0px)');
  });

  it('shows the coordinates of the cell under the mouse next to it, until it leaves', async () => {
    const { wrapper } = canvasView();
    resize(640, 640);
    await wrapper.vm.$nextTick();
    const viewport = wrapper.get('.viewport');
    await pointer(viewport, 'pointermove', { x: 12, y: 7 });
    expect(wrapper.get('.hover-label').text()).toBe('2, 1');
    await pointer(viewport, 'pointermove', { x: 13, y: 8 });
    expect(wrapper.get('.hover-label').text()).toBe('2, 1');
    await pointer(viewport, 'pointerleave');
    expect(wrapper.find('.hover-label').exists()).toBe(false);
  });

  it('draws the ring on the selected cell and the hover ring elsewhere only', async () => {
    const { wrapper } = canvasView({ selectedCell: { x: 2, y: 1 } });
    resize(640, 640);
    await wrapper.vm.$nextTick();
    const ring = wrapper.getComponent(SelectionRing);
    expect(ring.props('x')).toBe(12.5);

    const viewport = wrapper.get('.viewport');
    await pointer(viewport, 'pointermove', { x: 12, y: 7 });
    expect(wrapper.find('.hover-ring').exists()).toBe(false);
    expect(wrapper.find('.hover-label').exists()).toBe(false);
    await pointer(viewport, 'pointermove', { x: 30, y: 7 });
    expect(wrapper.find('.hover-ring').exists()).toBe(true);
    expect(wrapper.get('.hover-label').text()).toBe('6, 1');
  });

  it('shows the loupe over a small selected cell, and its picks as its own', async () => {
    const { wrapper } = canvasView({ selectedCell: { x: 60, y: 100 } });
    resize(640, 640);
    await wrapper.vm.$nextTick();
    const loupe = wrapper.getComponent(CellLoupe);
    // Above the cell: centre 502.5 px, ring 34 px, loupe 176 px
    expect(loupe.props('x')).toBe(302.5);
    expect(loupe.props('y')).toBe(502.5 - 25 - 88);
    loupe.vm.$emit('pick', { x: 61, y: 100 });
    expect(wrapper.emitted('pick')).toEqual([[{ x: 61, y: 100 }]]);
  });

  it('shows the coordinates of the selected cell in the loupe, not next to the ring', async () => {
    const { wrapper } = canvasView({ selectedCell: { x: 60, y: 100 } });
    resize(640, 640);
    await wrapper.vm.$nextTick();
    expect(wrapper.getComponent(SelectionRing).find('.label').exists()).toBe(false);
    const label = wrapper.get('.loupe-label');
    expect(label.text()).toBe('60, 100');
    // Next to the right edge of the cell in the middle of the lens, about 9.7 px from the centre
    const left = Number(/left: ([\d.]+)px/.exec(label.attributes('style')!)![1]);
    expect(left - 302.5 - 8).toBeCloseTo(LOUPE_MIDDLE_PX / 2, 0);
    expect(label.attributes('style')).toContain(`top: ${502.5 - 25 - 88}px`);
  });

  it('shows the coordinates of the cell under the mouse in the loupe there', async () => {
    const { wrapper } = canvasView({ selectedCell: { x: 60, y: 100 } });
    resize(640, 640);
    await wrapper.vm.$nextTick();
    const loupe = wrapper.getComponent(CellLoupe);
    loupe.vm.$emit('hover', { x: 62, y: 99 });
    await wrapper.vm.$nextTick();
    expect(wrapper.get('.loupe-label').text()).toBe('62, 99');
    // The ring on the canvas still shows the cell, without coordinates of its own
    expect(wrapper.find('.hover-ring').exists()).toBe(true);
    expect(wrapper.find('.hover-label').exists()).toBe(false);

    loupe.vm.$emit('hover', null);
    await wrapper.vm.$nextTick();
    expect(wrapper.get('.loupe-label').text()).toBe('60, 100');
  });

  it('shows no loupe once the cells are large enough to see', async () => {
    const { wrapper } = canvasView({ selectedCell: { x: 60, y: 100 } });
    resize(640, 640);
    const viewport = wrapper.get('.viewport');
    // 5 px per cell, 1.1 times larger per step: 12 px after 10 steps
    for (let i = 0; i < 10; i++) {
      await viewport.trigger('wheel', { deltaY: -100, clientX: 302, clientY: 502 });
    }
    expect(wrapper.findComponent(CellLoupe).exists()).toBe(false);
    expect(wrapper.find('.loupe-label').exists()).toBe(false);
    expect(wrapper.getComponent(SelectionRing).props('label')).toBe('60, 100');
  });

  describe('on a touch screen', () => {
    const finger = (id: number, x: number, y: number): Pointer => ({ id, type: 'touch', x, y });

    // A 640 px viewport 100 px from the left and 50 px from the top of the page
    function touchView(props: Parameters<typeof canvasView>[0] = {}) {
      const view = canvasView(props);
      resize(640, 640);
      const viewport = view.wrapper.get('.viewport');
      viewport.element.getBoundingClientRect = () =>
        ({ left: 100, top: 50, width: 640, height: 640 }) as DOMRect;
      return { ...view, viewport };
    }

    // Two fingers 100 px apart, the second one moved out to `secondX`
    async function pinch(viewport: ReturnType<typeof touchView>['viewport'], secondX: number) {
      await pointer(viewport, 'pointerdown', finger(1, 300, 250));
      await pointer(viewport, 'pointerdown', finger(2, 400, 250));
      await pointer(viewport, 'pointermove', finger(2, secondX, 250));
    }

    it('zooms around the middle of a pinch, and the canvas follows it', async () => {
      const { shown, viewport } = touchView();
      // Twice as far apart: zoom 2, 10 px per cell. The cell under the middle (250, 200 in
      // the viewport, cell 50, 40) is under the new middle (300, 200).
      await pinch(viewport, 500);
      expect(shown()).toContain('translate(-200px, -200px) scale(10)');
    });

    it('keeps a pinch within zoom 1 to 20', async () => {
      const { shown, viewport } = touchView();
      await pinch(viewport, 100_000);
      expect(shown()).toContain('scale(100)');
      await pointer(viewport, 'pointermove', finger(2, 301, 250));
      expect(shown()).toContain('translate(0px, 0px) scale(5)');
    });

    it('pans with the finger that is left when the other one is lifted', async () => {
      const { shown, viewport } = touchView();
      await pinch(viewport, 500);
      await pointer(viewport, 'pointerup', finger(2, 500, 250));
      await pointer(viewport, 'pointermove', finger(1, 290, 245));
      expect(shown()).toContain('translate(-210px, -205px) scale(10)');
    });

    it('pinches with the first two fingers, and a third one takes over where it is', async () => {
      const { shown, viewport } = touchView();
      await pinch(viewport, 500);
      await pointer(viewport, 'pointerdown', finger(3, 600, 250));
      await pointer(viewport, 'pointermove', finger(3, 700, 250));
      expect(shown()).toContain('translate(-200px, -200px) scale(10)');
      // Fingers 2 and 3 are 200 px apart, now 220: 1.1 times larger around their middle
      await pointer(viewport, 'pointerup', finger(1, 300, 250));
      await pointer(viewport, 'pointermove', finger(3, 720, 250));
      expect(shown()).toMatch(
        /translate\(-260(\.0+\d*)?px, -240(\.0+\d*)?px\) scale\(11(\.0+\d*)?\)/
      );
    });

    it('pans a zoomed canvas with one finger, and the end of it picks nothing', async () => {
      const { wrapper, canvas, shown, viewport } = touchView();
      await viewport.trigger('wheel', { deltaY: -100, clientX: 100, clientY: 50 });
      await pointer(viewport, 'pointerdown', finger(1, 200, 200));
      // Within 4 px it is still a tap
      await pointer(viewport, 'pointermove', finger(1, 197, 200));
      expect(shown()).toContain('translate(0px, 0px)');
      await pointer(viewport, 'pointermove', finger(1, 170, 190));
      expect(shown()).toContain('translate(-30px, -10px)');
      await pointer(viewport, 'pointerup', finger(1, 170, 190));
      await canvas.trigger('click', { clientX: 170, clientY: 190 });
      expect(wrapper.emitted('pick')).toBeUndefined();
      expect(wrapper.emitted('release')).toBeUndefined();
    });

    it('never ends a pinch with a tap, even one that does not move, but picks on the next tap', async () => {
      const { wrapper, canvas, viewport } = touchView();
      await pointer(viewport, 'pointerdown', finger(1, 12, 7));
      await pointer(viewport, 'pointerdown', finger(2, 40, 7));
      await pointer(viewport, 'pointerup', finger(2, 40, 7));
      await pointer(viewport, 'pointerup', finger(1, 12, 7));
      await canvas.trigger('click', { clientX: 12, clientY: 7 });
      expect(wrapper.emitted('pick')).toBeUndefined();

      // The viewport starts 100, 50 px into the page
      await pointer(viewport, 'pointerdown', finger(3, 112, 57));
      await pointer(viewport, 'pointerup', finger(3, 112, 57));
      await canvas.trigger('click', { clientX: 112, clientY: 57 });
      expect(wrapper.emitted('pick')).toEqual([[{ x: 2, y: 1 }]]);
    });

    it('forgets cancelled fingers, so the next one pans instead of pinching', async () => {
      const { shown, viewport } = touchView();
      await viewport.trigger('wheel', { deltaY: -100, clientX: 100, clientY: 50 });
      await pointer(viewport, 'pointerdown', finger(1, 200, 200));
      await pointer(viewport, 'pointerdown', finger(2, 300, 200));
      await pointer(viewport, 'pointercancel', finger(1, 200, 200));
      await pointer(viewport, 'pointercancel', finger(2, 300, 200));
      await pointer(viewport, 'pointerdown', finger(3, 200, 200));
      await pointer(viewport, 'pointermove', finger(3, 180, 200));
      expect(shown()).toContain('translate(-20px, 0px) scale(5.5');
    });

    it('does not show the cell under a finger', async () => {
      const { wrapper, viewport } = touchView();
      await pointer(viewport, 'pointermove', finger(1, 12, 7));
      expect(wrapper.find('.hover-ring').exists()).toBe(false);
      expect(wrapper.find('.hover-label').exists()).toBe(false);
    });

    it('does not pan when a finger presses and moves on the loupe', async () => {
      const { wrapper, shown, viewport } = touchView({ selectedCell: { x: 60, y: 100 } });
      await viewport.trigger('wheel', { deltaY: -100, clientX: 100, clientY: 50 });
      const loupe = wrapper.get('.loupe');
      await pointer(loupe, 'pointerdown', finger(1, 400, 400));
      await pointer(loupe, 'pointermove', finger(1, 300, 400));
      await pointer(loupe, 'pointerup', finger(1, 300, 400));
      expect(shown()).toContain('translate(0px, 0px)');
      // And the next finger on the canvas pans: the one on the loupe is not counted
      await pointer(viewport, 'pointerdown', finger(2, 200, 200));
      await pointer(viewport, 'pointermove', finger(2, 180, 200));
      expect(shown()).toContain('translate(-20px, 0px)');
    });
  });

  it('draws in screen pixels again when the window moves to a denser screen', async () => {
    // A media query for the current ratio reports when it stops matching
    const queries: { query: string; listener?: () => void; removed: boolean }[] = [];
    vi.stubGlobal('matchMedia', (query: string) => {
      const entry: (typeof queries)[number] = { query, removed: false };
      queries.push(entry);
      return {
        addEventListener: (_: string, listener: () => void) => (entry.listener = listener),
        removeEventListener: () => (entry.removed = true),
      };
    });
    vi.stubGlobal('devicePixelRatio', 1);
    const { wrapper, canvas } = canvasView();
    resize(640, 640);
    await wrapper.vm.$nextTick();
    const element = canvas.element as HTMLCanvasElement;
    expect(element.width).toBe(640);
    expect(queries.map(({ query }) => query)).toEqual(['(resolution: 1dppx)']);

    vi.stubGlobal('devicePixelRatio', 2);
    queries[0].listener!();
    await wrapper.vm.$nextTick();
    expect(element.width).toBe(1280);
    expect(element.style.width).toBe('640px');
    // The old query is dropped, the new one watches the new ratio
    expect(queries[0].removed).toBe(true);
    expect(queries[1].query).toBe('(resolution: 2dppx)');

    wrapper.unmount();
    expect(queries[1].removed).toBe(true);
  });

  it('dims the canvas while paused', () => {
    expect(canvasView({ paused: true }).wrapper.get('.viewport').classes()).toContain('paused');
  });

  it('draws cells on a source canvas and shows them on the page without smoothing', async () => {
    const tiny = { width: 2, height: 1 };
    const { wrapper, canvas, shown } = canvasView({ size: tiny });
    resize(640, 640);
    await wrapper.vm.$nextTick();
    const page = contexts.get(canvas.element as HTMLCanvasElement)!;
    // The page canvas covers the viewport, and the cells are 320 px each, centred
    expect((canvas.element as HTMLCanvasElement).width).toBe(640);
    expect(shown()).toBe('translate(0px, 160px) scale(320)');
    expect(page.imageSmoothingEnabled).toBe(false);

    wrapper.vm.draw(tiny, { pixels: [3, -1], eventId: 0, timestamp: 0 }, [
      { id: 3, color: '#00ff00' },
    ]);
    await wrapper.vm.$nextTick();
    const [source, cells] = [...contexts].find(([element]) => element !== canvas.element)!;
    expect(source.width).toBe(2);
    expect(cells.fillRect).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(page.drawImage).toHaveBeenLastCalledWith(source, 0, 0);

    page.drawImage.mockClear();
    wrapper.vm.paint({ x: 1, y: 0 }, '#0000ff');
    await wrapper.vm.$nextTick();
    expect(cells.fillStyle).toBe('#0000ff');
    expect(cells.fillRect).toHaveBeenLastCalledWith(1, 0, 1, 1);
    expect(page.drawImage).toHaveBeenCalledTimes(1);
  });
});
