// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import CanvasView from './CanvasView.vue';
import CellLoupe from './CellLoupe.vue';
import SelectionRing from './SelectionRing.vue';

// happy-dom measures nothing: the viewport size comes from a fake ResizeObserver and the
// canvas rectangle from a stub
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

const size = { width: 128, height: 128 };

function canvasView(props: Partial<InstanceType<typeof CanvasView>['$props']> = {}) {
  const wrapper = mount(CanvasView, {
    props: {
      size,
      selectedCell: null,
      selectedColor: '#ff0000',
      blooms: [],
      paused: false,
      placedCount: 0,
      placeFailed: false,
      ...props,
    },
  });
  // The canvas fills a 640 px viewport: 5 px per cell
  const canvas = wrapper.get('canvas');
  canvas.element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 640, height: 640 }) as DOMRect;
  return { wrapper, canvas };
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
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe('CanvasView', () => {
  it('fits the whole canvas into the viewport once it knows its size', async () => {
    const { wrapper, canvas } = canvasView();
    resize(640, 640);
    await wrapper.vm.$nextTick();
    expect(canvas.attributes('style')).toContain('translate(0px, 0px) scale(5)');

    // A wide viewport: the canvas is centred
    resize(1000, 640);
    await wrapper.vm.$nextTick();
    expect(canvas.attributes('style')).toContain('translate(180px, 0px) scale(5)');
  });

  it('zooms with the wheel', async () => {
    const { wrapper, canvas } = canvasView();
    resize(640, 640);
    await wrapper.get('.viewport').trigger('wheel', { deltaY: -100, clientX: 0, clientY: 0 });
    expect(canvas.attributes('style')).toContain('scale(5.5');
  });

  it('reports a clicked cell', async () => {
    const { wrapper, canvas } = canvasView();
    await canvas.trigger('click', { clientX: 12, clientY: 7 });
    expect(wrapper.emitted('pick')).toEqual([[{ x: 2, y: 1 }]]);
    // The click on the canvas is not one beside it
    expect(wrapper.emitted('release')).toBeUndefined();
  });

  it('reports a click beside the canvas, but not the end of a drag there', async () => {
    const { wrapper } = canvasView();
    resize(1000, 640);
    const viewport = wrapper.get('.viewport');
    await viewport.trigger('click', { clientX: 50, clientY: 300 });
    expect(wrapper.emitted('release')).toHaveLength(1);

    await pointer(viewport, 'pointerdown', { x: 100, y: 100 });
    await pointer(viewport, 'pointermove', { x: 60, y: 100 });
    await pointer(viewport, 'pointerup', { x: 60, y: 100 });
    await viewport.trigger('click', { clientX: 60, clientY: 100 });
    expect(wrapper.emitted('release')).toHaveLength(1);
  });

  it('does not report a click that ends a drag', async () => {
    const { wrapper, canvas } = canvasView();
    resize(640, 640);
    await wrapper.get('.viewport').trigger('wheel', { deltaY: -100, clientX: 0, clientY: 0 });
    const viewport = wrapper.get('.viewport');
    await pointer(viewport, 'pointerdown', { x: 100, y: 100 });
    await pointer(viewport, 'pointermove', { x: 80, y: 100 });
    await pointer(viewport, 'pointerup', { x: 80, y: 100 });
    await canvas.trigger('click', { clientX: 80, clientY: 100 });
    expect(wrapper.emitted('pick')).toBeUndefined();
    // The zoomed canvas moved with the mouse
    expect(canvas.attributes('style')).toContain('translate(-20px, 0px)');
  });

  it('reports the cell under the mouse, once per cell, and null when it leaves', async () => {
    const { wrapper } = canvasView();
    const viewport = wrapper.get('.viewport');
    await pointer(viewport, 'pointermove', { x: 12, y: 7 });
    await pointer(viewport, 'pointermove', { x: 13, y: 8 });
    await pointer(viewport, 'pointerleave');
    expect(wrapper.emitted('hover')).toEqual([[{ x: 2, y: 1 }], [null]]);
  });

  it('draws the ring on the selected cell and the hover ring elsewhere only', async () => {
    const { wrapper } = canvasView({ selectedCell: { x: 2, y: 1 } });
    resize(640, 640);
    await wrapper.vm.$nextTick();
    const ring = wrapper.getComponent(SelectionRing);
    expect(ring.props('label')).toBe('2, 1');
    expect(ring.props('x')).toBe(12.5);

    const viewport = wrapper.get('.viewport');
    await pointer(viewport, 'pointermove', { x: 12, y: 7 });
    expect(wrapper.find('.hover-ring').exists()).toBe(false);
    await pointer(viewport, 'pointermove', { x: 30, y: 7 });
    expect(wrapper.find('.hover-ring').exists()).toBe(true);
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

  it('shows no loupe once the cells are large enough to see', async () => {
    const { wrapper } = canvasView({ selectedCell: { x: 60, y: 100 } });
    resize(640, 640);
    const viewport = wrapper.get('.viewport');
    // 5 px per cell, 1.1 times larger per step: 12 px after 10 steps
    for (let i = 0; i < 10; i++) {
      await viewport.trigger('wheel', { deltaY: -100, clientX: 302, clientY: 502 });
    }
    expect(wrapper.findComponent(CellLoupe).exists()).toBe(false);
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
      const { canvas, viewport } = touchView();
      // Twice as far apart: zoom 2, 10 px per cell. The cell under the middle (250, 200 in
      // the viewport, cell 50, 40) is under the new middle (300, 200).
      await pinch(viewport, 500);
      expect(canvas.attributes('style')).toContain('translate(-200px, -200px) scale(10)');
    });

    it('keeps a pinch within zoom 1 to 20', async () => {
      const { canvas, viewport } = touchView();
      await pinch(viewport, 100_000);
      expect(canvas.attributes('style')).toContain('scale(100)');
      await pointer(viewport, 'pointermove', finger(2, 301, 250));
      expect(canvas.attributes('style')).toContain('translate(0px, 0px) scale(5)');
    });

    it('pans with the finger that is left when the other one is lifted', async () => {
      const { canvas, viewport } = touchView();
      await pinch(viewport, 500);
      await pointer(viewport, 'pointerup', finger(2, 500, 250));
      await pointer(viewport, 'pointermove', finger(1, 290, 245));
      expect(canvas.attributes('style')).toContain('translate(-210px, -205px) scale(10)');
    });

    it('pinches with the first two fingers, and a third one takes over where it is', async () => {
      const { canvas, viewport } = touchView();
      await pinch(viewport, 500);
      await pointer(viewport, 'pointerdown', finger(3, 600, 250));
      await pointer(viewport, 'pointermove', finger(3, 700, 250));
      expect(canvas.attributes('style')).toContain('translate(-200px, -200px) scale(10)');
      // Fingers 2 and 3 are 200 px apart, now 220: 1.1 times larger around their middle
      await pointer(viewport, 'pointerup', finger(1, 300, 250));
      await pointer(viewport, 'pointermove', finger(3, 720, 250));
      expect(canvas.attributes('style')).toMatch(
        /translate\(-260(\.0+\d*)?px, -240(\.0+\d*)?px\) scale\(11(\.0+\d*)?\)/
      );
    });

    it('pans a zoomed canvas with one finger, and the end of it picks nothing', async () => {
      const { wrapper, canvas, viewport } = touchView();
      await viewport.trigger('wheel', { deltaY: -100, clientX: 100, clientY: 50 });
      await pointer(viewport, 'pointerdown', finger(1, 200, 200));
      // Within 4 px it is still a tap
      await pointer(viewport, 'pointermove', finger(1, 197, 200));
      expect(canvas.attributes('style')).toContain('translate(0px, 0px)');
      await pointer(viewport, 'pointermove', finger(1, 170, 190));
      expect(canvas.attributes('style')).toContain('translate(-30px, -10px)');
      await pointer(viewport, 'pointerup', finger(1, 170, 190));
      await canvas.trigger('click', { clientX: 170, clientY: 190 });
      await viewport.trigger('click', { clientX: 170, clientY: 190 });
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

      await pointer(viewport, 'pointerdown', finger(3, 12, 7));
      await pointer(viewport, 'pointerup', finger(3, 12, 7));
      await canvas.trigger('click', { clientX: 12, clientY: 7 });
      expect(wrapper.emitted('pick')).toEqual([[{ x: 2, y: 1 }]]);
    });

    it('forgets cancelled fingers, so the next one pans instead of pinching', async () => {
      const { canvas, viewport } = touchView();
      await viewport.trigger('wheel', { deltaY: -100, clientX: 100, clientY: 50 });
      await pointer(viewport, 'pointerdown', finger(1, 200, 200));
      await pointer(viewport, 'pointerdown', finger(2, 300, 200));
      await pointer(viewport, 'pointercancel', finger(1, 200, 200));
      await pointer(viewport, 'pointercancel', finger(2, 300, 200));
      await pointer(viewport, 'pointerdown', finger(3, 200, 200));
      await pointer(viewport, 'pointermove', finger(3, 180, 200));
      expect(canvas.attributes('style')).toContain('translate(-20px, 0px) scale(5.5');
    });

    it('does not show the cell under a finger', async () => {
      const { wrapper, viewport } = touchView();
      await pointer(viewport, 'pointermove', finger(1, 12, 7));
      await pointer(viewport, 'pointerleave', finger(1, 12, 7));
      expect(wrapper.emitted('hover')).toBeUndefined();
    });

    it('does not pan when a finger presses and moves on the loupe', async () => {
      const { wrapper, canvas, viewport } = touchView({ selectedCell: { x: 60, y: 100 } });
      await viewport.trigger('wheel', { deltaY: -100, clientX: 100, clientY: 50 });
      const loupe = wrapper.get('.loupe');
      await pointer(loupe, 'pointerdown', finger(1, 400, 400));
      await pointer(loupe, 'pointermove', finger(1, 300, 400));
      await pointer(loupe, 'pointerup', finger(1, 300, 400));
      expect(canvas.attributes('style')).toContain('translate(0px, 0px)');
      // And the next finger on the canvas pans: the one on the loupe is not counted
      await pointer(viewport, 'pointerdown', finger(2, 200, 200));
      await pointer(viewport, 'pointermove', finger(2, 180, 200));
      expect(canvas.attributes('style')).toContain('translate(-20px, 0px)');
    });
  });

  it('dims the canvas while paused', () => {
    expect(canvasView({ paused: true }).wrapper.get('.viewport').classes()).toContain('paused');
  });

  it('draws a snapshot and single cells on the canvas element', () => {
    const { wrapper, canvas } = canvasView();
    const element = canvas.element as HTMLCanvasElement;
    const ctx = { fillStyle: '', fillRect: vi.fn() };
    element.getContext = vi.fn(() => ctx) as unknown as HTMLCanvasElement['getContext'];

    wrapper.vm.draw({ width: 2, height: 1 }, { pixels: [3, -1], eventId: 0, timestamp: 0 }, [
      { id: 3, color: '#00ff00' },
    ]);
    expect(element.width).toBe(2);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1, 1);

    wrapper.vm.paint({ x: 1, y: 0 }, '#0000ff');
    expect(ctx.fillStyle).toBe('#0000ff');
    expect(ctx.fillRect).toHaveBeenLastCalledWith(1, 0, 1, 1);
  });
});
