// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import PaletteDock from './PaletteDock.vue';
import ConfirmButton from './ConfirmButton.vue';

// Ids with a gap on purpose: the dock must use ids, not positions in the list
const palette = [
  { id: 2, color: '#00A2E8' },
  { id: 7, color: '#123ABC' },
];

function dock(props: Partial<InstanceType<typeof PaletteDock>['$props']> = {}) {
  return mount(PaletteDock, {
    props: {
      palette,
      selectedId: 7,
      hint: 'Pick a cell',
      error: '',
      placeLabel: 'Place',
      canPlace: true,
      ...props,
    },
  });
}

describe('PaletteDock', () => {
  it('shows one swatch per colour, named in its tooltip, with the selected one marked', () => {
    const swatches = dock().findAll('.swatch');
    expect(swatches.map((s) => s.attributes('title'))).toEqual(['Žydra', '#123ABC']);
    expect(swatches.map((s) => s.classes().includes('selected'))).toEqual([false, true]);
  });

  it('reports the colour that was clicked', async () => {
    const wrapper = dock();
    await wrapper.findAll('.swatch')[0].trigger('click');
    expect(wrapper.emitted('select')).toEqual([[palette[0]]]);
  });

  it('shows the hint, or the error instead of it', () => {
    expect(dock().text()).toContain('Pick a cell');
    const failed = dock({ error: 'Failed' });
    expect(failed.get('.error').text()).toBe('Failed');
    expect(failed.text()).not.toContain('Pick a cell');
  });

  it('passes the label and the state on to the button and reports a place', async () => {
    const disabled = dock({ canPlace: false });
    expect(disabled.getComponent(ConfirmButton).props()).toEqual({
      label: 'Place',
      disabled: true,
    });

    const enabled = dock();
    await enabled.getComponent(ConfirmButton).trigger('click');
    expect(enabled.emitted('place')).toHaveLength(1);
  });
});
