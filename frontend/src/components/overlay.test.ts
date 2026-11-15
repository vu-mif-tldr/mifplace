// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import BloomLayer from './BloomLayer.vue';
import SelectionRing from './SelectionRing.vue';

describe('SelectionRing', () => {
  const props = {
    x: 100,
    y: 50,
    cellPx: 5,
    color: '#ff0000',
    label: '4, 7',
    placedCount: 0,
    failed: false,
  };

  it('sits on the cell centre with its coordinates', () => {
    const wrapper = mount(SelectionRing, { props });
    expect(wrapper.attributes('style')).toContain('left: 100px');
    expect(wrapper.attributes('style')).toContain('top: 50px');
    expect(wrapper.get('.label').text()).toBe('4, 7');
    expect(wrapper.get('.cell').attributes('style')).toContain('background: #ff0000');
  });

  it('is at least 34 px wide and grows with the zoom', () => {
    expect(mount(SelectionRing, { props }).get('.circle').attributes('style')).toContain(
      'width: 34px'
    );
    const zoomed = mount(SelectionRing, { props: { ...props, cellPx: 40 } });
    expect(zoomed.get('.circle').attributes('style')).toContain('width: 58px');
  });

  it('plays the placed animation after a pixel and shows a failure', () => {
    expect(mount(SelectionRing, { props }).get('.circle').classes()).not.toContain('landed');
    const placed = mount(SelectionRing, { props: { ...props, placedCount: 1 } });
    expect(placed.get('.circle').classes()).toContain('landed');
    const failed = mount(SelectionRing, { props: { ...props, failed: true } });
    expect(failed.get('.circle').classes()).toContain('failed');
  });
});

describe('BloomLayer', () => {
  it('puts one bloom on the centre of each cell, in its colour', () => {
    const wrapper = mount(BloomLayer, {
      props: {
        blooms: [
          { id: 1, x: 0, y: 0, color: '#00a2e8', born: 0 },
          { id: 2, x: 3, y: 1, color: '#ff0000', born: 0 },
        ],
        offset: { x: 10, y: 20 },
        cellPx: 10,
      },
    });
    const blooms = wrapper.findAll('.bloom');
    expect(blooms).toHaveLength(2);
    expect(blooms[0].attributes('style')).toContain('left: 15px');
    expect(blooms[1].attributes('style')).toContain('left: 45px');
    expect(blooms[1].attributes('style')).toContain('top: 35px');
    // At least 48 px, so a bloom shows even when the whole canvas is in view
    expect(blooms[0].attributes('style')).toContain('width: 90px');
  });
});
