// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import BloomLayer from './BloomLayer.vue';
import { BLOOM_EFFECTS } from '../blooms';
import SelectionRing from './SelectionRing.vue';

describe('SelectionRing', () => {
  const props = {
    x: 100,
    y: 50,
    cellPx: 5,
    color: '#ff0000',
    label: '4, 7',
  };

  it('sits on the cell centre with its coordinates', () => {
    const wrapper = mount(SelectionRing, { props });
    expect(wrapper.attributes('style')).toContain('left: 100px');
    expect(wrapper.attributes('style')).toContain('top: 50px');
    expect(wrapper.get('.label').text()).toBe('4, 7');
    expect(wrapper.get('.cell').attributes('style')).toContain('background: #ff0000');
  });

  it('puts its coordinates outside the ring, which grows with the zoom', () => {
    expect(mount(SelectionRing, { props }).get('.label').attributes('style')).toContain(
      'left: 25px'
    );
    const zoomed = mount(SelectionRing, { props: { ...props, cellPx: 40 } });
    expect(zoomed.get('.label').attributes('style')).toContain('left: 37px');
  });

  it('covers exactly the cell: ticks around a small one, a frame inside a large one', () => {
    const small = mount(SelectionRing, { props });
    expect(small.get('.cell').attributes('style')).toContain('width: 5px');
    expect(small.get('.cell').classes()).not.toContain('framed');
    // From one cell away (7.5 px from the centre) to inside the ring (17 - 6 px)
    const tick = small.get('.tick');
    expect([tick.attributes('x1'), tick.attributes('x2')]).toEqual(['7.5', '11']);
    expect(small.findAll('.tick')).toHaveLength(4);

    const large = mount(SelectionRing, { props: { ...props, cellPx: 40 } });
    expect(large.get('.cell').attributes('style')).toContain('width: 40px');
    expect(large.get('.cell').classes()).toContain('framed');
    expect(large.find('.ticks').exists()).toBe(false);
  });
});

describe('BloomLayer', () => {
  const props = {
    blooms: [
      { id: 1, x: 0, y: 0, color: '#00a2e8', born: 0 },
      { id: 2, x: 3, y: 1, color: '#ff0000', born: 0 },
    ],
    offset: { x: 10, y: 20 },
    cellPx: 10,
  };

  it('puts a glow and a ring on the centre of each cell, in its colour', () => {
    const wrapper = mount(BloomLayer, { props });
    const blooms = wrapper.findAll('.bloom');
    expect(blooms).toHaveLength(2);
    expect(blooms[0].attributes('style')).toContain('left: 15px');
    expect(blooms[1].attributes('style')).toContain('left: 45px');
    expect(blooms[1].attributes('style')).toContain('top: 35px');
    // At least 48 px, so a bloom shows even when the whole canvas is in view
    expect(blooms[0].attributes('style')).toContain('width: 90px');
    expect(wrapper.findAll('.ring')).toHaveLength(2);
    expect(wrapper.findAll('.ring')[1].attributes('style')).toContain('--bloom: #ff0000');
  });

  it('leaves out the glow when it is switched off and repeats the rings', () => {
    const effects = {
      glow: { ...BLOOM_EFFECTS.glow, enabled: false },
      ring: { ...BLOOM_EFFECTS.ring, waves: 3, gapMs: 200 },
    };
    const wrapper = mount(BloomLayer, { props: { ...props, effects } });
    expect(wrapper.findAll('.bloom')).toHaveLength(0);
    const rings = wrapper.findAll('.ring');
    expect(rings).toHaveLength(6);
    expect(rings[2].attributes('style')).toContain('--delay: 400ms');
  });
});
