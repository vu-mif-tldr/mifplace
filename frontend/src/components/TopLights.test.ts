// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import TopLights from './TopLights.vue';
import { TOP_LIGHT_KEYFRAMES, TOP_LIGHT_MS } from '../topLights';

describe('TopLights', () => {
  const original = window.HTMLElement.prototype.animate;
  afterEach(() => {
    window.HTMLElement.prototype.animate = original;
    vi.restoreAllMocks();
  });

  it('plays every light from its age, once, and again when it rises again', async () => {
    const animate = vi.fn();
    window.HTMLElement.prototype.animate = animate;
    vi.spyOn(window.performance, 'now').mockReturnValue(1000);

    const wrapper = mount(TopLights, {
      props: { lights: [{ id: 1, color: '#ff0000', start: 900 }] },
    });
    expect(wrapper.findAll('.light')).toHaveLength(1);
    expect(animate).toHaveBeenCalledWith(TOP_LIGHT_KEYFRAMES, {
      duration: TOP_LIGHT_MS,
      delay: -100,
      fill: 'both',
    });

    // Drawing again does not restart it
    await wrapper.setProps({ lights: [{ id: 1, color: '#ff0000', start: 900 }] });
    expect(animate).toHaveBeenCalledTimes(1);

    // Rising again is a new start: played again from there
    await wrapper.setProps({ lights: [{ id: 1, color: '#ff0000', start: 950 }] });
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls[1][1]).toMatchObject({ delay: -50 });
  });
});
