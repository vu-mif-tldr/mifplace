// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import ActivityTicker from './ActivityTicker.vue';
import { BELT_SPEED } from '../belt';
import { MAX_BATCH_FOR_BLOOMS } from '../blooms';
import { INK } from '../glow';
import { texts } from '../texts';

// The belt runs on requestAnimationFrame: the test runs the frames itself. happy-dom measures
// nothing: the strip gets its width from a fake ResizeObserver, every message is WIDTH px wide.
const STRIP = 800;
const WIDTH = 100;

let frames: ((time: number) => void)[] = [];
let clock = 0;
let resizeCallback: (entries: { contentRect: { width: number } }[]) => void = () => {};
let reducedMotion = false;

class FakeResizeObserver {
  constructor(callback: typeof resizeCallback) {
    resizeCallback = callback;
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  frames = [];
  clock = 0;
  reducedMotion = false;
  vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(window.performance, 'now').mockImplementation(() => clock);
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => WIDTH,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Runs the animation for `seconds` in frames of 1/60 s
async function run(wrapper: ReturnType<typeof ticker>, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    clock += 1000 / 60;
    const due = frames;
    frames = [];
    for (const callback of due) callback(clock);
    // Vue draws between two frames, as the browser does
    await wrapper.vm.$nextTick();
  }
}

function ticker(props: Partial<InstanceType<typeof ActivityTicker>['$props']> = {}) {
  const wrapper = mount(ActivityTicker, {
    props: { selectedCell: null, selectedColor: undefined, ...props },
  });
  resizeCallback([{ contentRect: { width: STRIP } }]);
  return wrapper;
}

type Wrapper = ReturnType<typeof ticker>;
const items = (wrapper: Wrapper) => wrapper.findAll('li');
const texts_ = (wrapper: Wrapper) => items(wrapper).map((li) => li.text().replace(/\s+/g, ' '));
const quiet = (wrapper: Wrapper) => wrapper.find('.quiet').exists();
const red = (x: number, y = x) => ({ x, y, color: '#FF0000' });
// "Dabar ramu..." waits this long after the last new pixel, s
const QUIET_AFTER = 10;
const left = (li: ReturnType<Wrapper['findAll']>[number]) =>
  Number(/translateX\((-?[\d.]+)px\)/.exec(li.attributes('style') ?? '')?.[1]);

describe('ActivityTicker', () => {
  it('starts with "Dabar ramu..." at the left edge and nothing on the belt', async () => {
    const wrapper = ticker();
    await run(wrapper, 2 / 60);
    expect(quiet(wrapper)).toBe(true);
    expect(wrapper.get('.quiet').text()).toBe(texts.quiet);
    expect(items(wrapper)).toHaveLength(0);
  });

  it('shows a new pixel as "● x, y" in its colour with a contrasting outline', async () => {
    const wrapper = ticker();
    await run(wrapper, 2 / 60);
    wrapper.vm.announce([
      { x: 4, y: 7, color: '#FFF200' },
      { x: 5, y: 7, color: '#000000' },
    ]);
    await run(wrapper, 2 / 60);
    expect(texts_(wrapper)).toEqual(['4, 7', '5, 7']);
    const dots = wrapper.findAll('.dot');
    expect(dots[0].attributes('style')).toContain(`border-color: ${INK}`);
    expect(dots[1].attributes('style')).toContain('background: #000000');
    expect(dots[1].attributes('style')).toContain('border-color: #ffffff');
  });

  it('sends "Dabar ramu..." away when a new pixel comes', async () => {
    const wrapper = ticker();
    await run(wrapper, 2 / 60);
    wrapper.vm.announce([red(1)]);
    await run(wrapper, 1 / 60);
    expect(quiet(wrapper)).toBe(false);
  });

  it('pushes the belt so a new pixel is fully in view in a fraction of a second', async () => {
    const wrapper = ticker();
    await run(wrapper, 2 / 60);
    wrapper.vm.announce([red(1), red(2), red(3)]);
    await run(wrapper, 0.3);
    const all = items(wrapper);
    const last = all[all.length - 1];
    expect(last.text()).toBe('3, 3');
    expect(left(last) + WIDTH).toBeLessThanOrEqual(STRIP);
    expect(left(last) + WIDTH).toBeGreaterThan(STRIP - 30);
  });

  it('then runs to the left at the normal speed', async () => {
    const wrapper = ticker();
    await run(wrapper, 2 / 60);
    wrapper.vm.announce([red(1)]);
    await run(wrapper, 0.5);
    const before = left(items(wrapper)[0]);
    await run(wrapper, 1);
    expect(before - left(items(wrapper)[0])).toBeCloseTo(BELT_SPEED, -1);
  });

  it('does not announce a catch-up batch', async () => {
    const wrapper = ticker();
    await run(wrapper, 2 / 60);
    wrapper.vm.announce(Array.from({ length: MAX_BATCH_FOR_BLOOMS + 1 }, (_, i) => red(i, 0)));
    await run(wrapper, 2 / 60);
    expect(items(wrapper)).toHaveLength(0);
    expect(quiet(wrapper)).toBe(true);
  });

  it('brings "Dabar ramu..." back once the last pixel has left and it has been quiet a while', async () => {
    const wrapper = ticker();
    await run(wrapper, 2 / 60);
    wrapper.vm.announce([red(1)]);
    // Quiet long enough, but the pixel is still in view
    await run(wrapper, QUIET_AFTER);
    expect(items(wrapper)).toHaveLength(1);
    expect(quiet(wrapper)).toBe(false);
    // It has left
    await run(wrapper, STRIP / BELT_SPEED - QUIET_AFTER + 0.5);
    expect(items(wrapper)).toHaveLength(0);
    expect(quiet(wrapper)).toBe(true);
  });

  it('shows the selected cell as one "Tavo: ● (x, y)" that follows the selection', async () => {
    const wrapper = ticker({ selectedCell: { x: 5, y: 6 }, selectedColor: '#00A2E8' });
    await run(wrapper, 2 / 60);
    expect(texts_(wrapper)).toContain(`${texts.yours} ${texts.coordinates(5, 6)}`);

    await wrapper.setProps({ selectedCell: { x: 7, y: 8 }, selectedColor: '#000000' });
    await run(wrapper, 1 / 60);
    const yours = items(wrapper).filter((li) => li.text().startsWith(texts.yours));
    expect(yours).toHaveLength(1);
    expect(yours[0].text().replace(/\s+/g, ' ')).toBe(`${texts.yours} ${texts.coordinates(7, 8)}`);
    expect(yours[0].get('.dot').attributes('style')).toContain('background: #000000');
  });

  it('lets "Tavo" wait its turn behind the right edge, without a push', async () => {
    const wrapper = ticker();
    await run(wrapper, 2 / 60);
    wrapper.vm.announce([red(1)]);
    await run(wrapper, 0.5);
    const pixel = left(items(wrapper)[0]);
    await wrapper.setProps({ selectedCell: { x: 5, y: 6 }, selectedColor: '#00A2E8' });
    await run(wrapper, 0.3);
    // The belt kept its normal speed...
    expect(pixel - left(items(wrapper)[0])).toBeCloseTo(BELT_SPEED * 0.3, -1);
    // ...and "Tavo" is still coming in, not pushed fully into view
    expect(texts_(wrapper)[1]).toBe(`${texts.yours} ${texts.coordinates(5, 6)}`);
    expect(left(items(wrapper)[1])).toBeGreaterThan(STRIP - WIDTH + 50);
  });

  it('keeps "Dabar ramu..." while "Tavo" runs under it', async () => {
    const wrapper = ticker();
    await run(wrapper, 2 / 60);
    await wrapper.setProps({ selectedCell: { x: 5, y: 6 }, selectedColor: '#00A2E8' });
    await run(wrapper, 1);
    expect(items(wrapper)).toHaveLength(1);
    expect(quiet(wrapper)).toBe(true);
  });

  it('does not move without motion, but still makes room for a new pixel', async () => {
    reducedMotion = true;
    const wrapper = ticker();
    await run(wrapper, 2 / 60);
    wrapper.vm.announce([red(1)]);
    await run(wrapper, 2 / 60);
    const pixel = left(items(wrapper)[0]);
    expect(pixel).toBe(STRIP - WIDTH);
    await run(wrapper, 1);
    expect(left(items(wrapper)[0])).toBe(pixel);

    wrapper.vm.announce([red(2)]);
    await run(wrapper, 2 / 60);
    expect(left(items(wrapper)[1])).toBe(STRIP - WIDTH);
  });

  it('without motion brings "Dabar ramu..." back while old pixels still stand', async () => {
    reducedMotion = true;
    const wrapper = ticker();
    await run(wrapper, 2 / 60);
    wrapper.vm.announce([red(1)]);
    await run(wrapper, QUIET_AFTER - 0.5);
    expect(quiet(wrapper)).toBe(false);
    await run(wrapper, 1);
    expect(items(wrapper)).toHaveLength(1);
    expect(quiet(wrapper)).toBe(true);
  });
});
