// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { LOUPE_SIDE } from '../loupe';
import CellLoupe from './CellLoupe.vue';

const props = {
  source: null,
  size: { width: 128, height: 128 },
  cell: { x: 64, y: 72 },
  color: '#ff0000',
  x: 300,
  y: 200,
  drawn: 0,
};
const middle = LOUPE_SIDE / 2;

// happy-dom measures nothing: the loupe sits at (0, 0)
function loupe(more: Partial<typeof props> = {}) {
  const wrapper = mount(CellLoupe, { props: { ...props, ...more } });
  wrapper.element.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
  return wrapper;
}

describe('CellLoupe', () => {
  it('sits where it is told', () => {
    const style = loupe().attributes('style');
    expect(style).toContain('left: 300px');
    expect(style).toContain(`width: ${LOUPE_SIDE}px`);
  });

  it('picks the cell clicked in it', async () => {
    const wrapper = loupe();
    await wrapper.trigger('click', { clientX: middle + 24, clientY: middle - 24 });
    await wrapper.trigger('click', { clientX: middle, clientY: middle });
    expect(wrapper.emitted('pick')).toEqual([[{ x: 65, y: 71 }], [{ x: 64, y: 72 }]]);
  });

  it('picks nothing off the canvas or outside the lens', async () => {
    const wrapper = loupe({ cell: { x: 0, y: 0 } });
    await wrapper.trigger('click', { clientX: 10, clientY: middle });
    await wrapper.trigger('click', { clientX: 2, clientY: 2 });
    expect(wrapper.emitted('pick')).toBeUndefined();
  });

  it('reports the cell under the mouse once, and null when it leaves', async () => {
    const wrapper = loupe();
    await wrapper.trigger('pointermove', { clientX: middle + 24, clientY: middle });
    await wrapper.trigger('pointermove', { clientX: middle + 25, clientY: middle });
    await wrapper.trigger('pointerleave');
    expect(wrapper.emitted('hover')).toEqual([[{ x: 65, y: 72 }], [null]]);
  });

  it('does not show the cell under a finger', async () => {
    const wrapper = loupe();
    await wrapper.trigger('pointermove', {
      pointerType: 'touch',
      clientX: middle,
      clientY: middle,
    });
    await wrapper.trigger('pointerleave', { pointerType: 'touch' });
    expect(wrapper.emitted('hover')).toBeUndefined();
  });

  it('reads the cells around the selected one, again after every drawing', async () => {
    const source = document.createElement('canvas');
    const ctx = {
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(15 * 15 * 4) })),
      createImageData: vi.fn((w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      })),
      putImageData: vi.fn(),
    };
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const wrapper = loupe({ source: source as unknown as null });
    expect(ctx.getImageData).toHaveBeenCalledWith(57, 65, 15, 15);
    expect(ctx.putImageData).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ drawn: 1 });
    expect(ctx.putImageData).toHaveBeenCalledTimes(2);
    getContext.mockRestore();
  });
});
