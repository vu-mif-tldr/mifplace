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
  });

  it('does not report a click that ends a drag', async () => {
    const { wrapper, canvas } = canvasView();
    resize(640, 640);
    await wrapper.get('.viewport').trigger('wheel', { deltaY: -100, clientX: 0, clientY: 0 });
    const viewport = wrapper.get('.viewport');
    await viewport.trigger('mousedown', { clientX: 100, clientY: 100 });
    await viewport.trigger('mousemove', { clientX: 80, clientY: 100 });
    await viewport.trigger('mouseup');
    await canvas.trigger('click', { clientX: 80, clientY: 100 });
    expect(wrapper.emitted('pick')).toBeUndefined();
    // The zoomed canvas moved with the mouse
    expect(canvas.attributes('style')).toContain('translate(-20px, 0px)');
  });

  it('reports the cell under the mouse, once per cell, and null when it leaves', async () => {
    const { wrapper } = canvasView();
    const viewport = wrapper.get('.viewport');
    await viewport.trigger('mousemove', { clientX: 12, clientY: 7 });
    await viewport.trigger('mousemove', { clientX: 13, clientY: 8 });
    await viewport.trigger('mouseleave');
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
    await viewport.trigger('mousemove', { clientX: 12, clientY: 7 });
    expect(wrapper.find('.hover-ring').exists()).toBe(false);
    await viewport.trigger('mousemove', { clientX: 30, clientY: 7 });
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
