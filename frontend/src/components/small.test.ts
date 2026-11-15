// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import BrandMark from './BrandMark.vue';
import ConfirmButton from './ConfirmButton.vue';
import LiveStatus from './LiveStatus.vue';
import LoadState from './LoadState.vue';
import TopBar from './TopBar.vue';
import { texts } from '../texts';

describe('BrandMark', () => {
  it('shows the name with the logo hidden from screen readers', () => {
    const wrapper = mount(BrandMark, { props: { size: 40 } });
    expect(wrapper.text()).toBe('vu.place');
    const svg = wrapper.get('svg');
    expect(svg.attributes('aria-hidden')).toBe('true');
    expect(svg.attributes('width')).toBe('40');
  });
});

describe('LiveStatus', () => {
  it.each([
    ['connected', texts.live],
    ['connecting', texts.connecting],
    ['reconnecting', texts.reconnecting],
  ] as const)('says %s in words', (state, label) => {
    const wrapper = mount(LiveStatus, { props: { state } });
    expect(wrapper.text()).toBe(label);
    expect(wrapper.classes()).toContain(state);
    expect(wrapper.attributes('role')).toBe('status');
  });
});

describe('TopBar', () => {
  it('shows the cell under the mouse and the connection', () => {
    const wrapper = mount(TopBar, {
      props: { hoveredCell: { x: 3, y: 9 }, liveState: 'connected' },
    });
    expect(wrapper.text()).toContain('3, 9');
    expect(wrapper.findComponent(LiveStatus).exists()).toBe(true);
  });

  it('shows neither without a cell or a connection', () => {
    const wrapper = mount(TopBar, { props: { hoveredCell: null, liveState: null } });
    expect(wrapper.find('.coords').exists()).toBe(false);
    expect(wrapper.findComponent(LiveStatus).exists()).toBe(false);
  });
});

describe('LoadState', () => {
  it('shows a spinner while loading', () => {
    const wrapper = mount(LoadState, { props: { failed: false } });
    expect(wrapper.find('.spinner').exists()).toBe(true);
    expect(wrapper.text()).toBe(texts.loading);
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('offers to try again when loading failed', async () => {
    const wrapper = mount(LoadState, { props: { failed: true } });
    expect(wrapper.text()).toContain(texts.loadFailed);
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });
});

describe('ConfirmButton', () => {
  it('is named by its label and reports a press', async () => {
    const wrapper = mount(ConfirmButton, { props: { label: 'Dėti', disabled: false } });
    expect(wrapper.attributes('aria-label')).toBe('Dėti');
    expect(wrapper.text()).toBe('Dėti');
    await wrapper.trigger('click');
    expect(wrapper.emitted('press')).toHaveLength(1);
  });

  it('does nothing while disabled', async () => {
    const wrapper = mount(ConfirmButton, { props: { label: 'Dėti', disabled: true } });
    expect(wrapper.attributes('disabled')).toBeDefined();
    await wrapper.trigger('click');
    expect(wrapper.emitted('press')).toBeUndefined();
  });
});
