import { MAX_BATCH_FOR_BLOOMS } from './blooms';
import {
  HOLD_MS,
  MAX_TOP_LIGHTS,
  RISE_MS,
  TOP_LIGHT_KEYFRAMES,
  TOP_LIGHT_MS,
  addTopLights,
  levelAt,
  pruneTopLights,
} from './topLights';

const colors = (n: number) => Array.from({ length: n }, (_, i) => `#00000${i % 10}`);
const PEAK_END = RISE_MS + HOLD_MS;

describe('levelAt', () => {
  it('rises to the peak, holds it and fades out', () => {
    expect(levelAt(0)).toBe(0);
    expect(levelAt(RISE_MS / 2)).toBeCloseTo(0.5);
    expect(levelAt(RISE_MS)).toBe(1);
    expect(levelAt(PEAK_END)).toBe(1);
    expect(levelAt(PEAK_END + 1)).toBeLessThan(1);
    expect(levelAt(TOP_LIGHT_MS - 1)).toBeGreaterThan(0);
    expect(levelAt(TOP_LIGHT_MS)).toBe(0);
  });

  it('is the curve the page plays', () => {
    for (const { offset, opacity } of TOP_LIGHT_KEYFRAMES) {
      const age = (offset as number) * TOP_LIGHT_MS;
      if (age > 0 && age < TOP_LIGHT_MS) expect(levelAt(age)).toBeCloseTo(opacity as number);
    }
  });
});

describe('addTopLights', () => {
  it('starts a light for every new colour', () => {
    const lights = addTopLights([], ['#ff0000', '#00ff00'], 0);
    expect(lights.map((light) => light.color)).toEqual(['#ff0000', '#00ff00']);
    expect(lights.every((light) => light.start === 0)).toBe(true);
  });

  it('starts no more than MAX_TOP_LIGHTS at once, keeping the first ones', () => {
    const lights = addTopLights([], colors(5), 0);
    expect(lights.map((light) => light.color)).toEqual(colors(MAX_TOP_LIGHTS));
  });

  it('does not start a new light while the most are shining', () => {
    const full = addTopLights([], colors(MAX_TOP_LIGHTS), 0);
    expect(addTopLights(full, ['#ff0000'], TOP_LIGHT_MS - 1)).toEqual(full);
  });

  it('starts one again once a light has gone out', () => {
    let lights = addTopLights([], ['#000001'], 0);
    lights = addTopLights(lights, ['#000002', '#000003'], 500);
    lights = addTopLights(lights, ['#ff0000'], TOP_LIGHT_MS);
    expect(lights.map((light) => light.color)).toEqual(['#000002', '#000003', '#ff0000']);
  });

  it('lights nothing for a catch-up batch', () => {
    expect(addTopLights([], colors(MAX_BATCH_FOR_BLOOMS + 1), 0)).toEqual([]);
  });

  describe('the same colour again', () => {
    const red = addTopLights([], ['#ff0000'], 0);

    it('is ignored while its light rises or holds the peak', () => {
      expect(addTopLights(red, ['#ff0000'], RISE_MS / 2)).toEqual(red);
      expect(addTopLights(red, ['#ff0000'], PEAK_END)).toEqual(red);
    });

    it('never takes a second light, even with room for one', () => {
      expect(addTopLights([], ['#ff0000', '#ff0000'], 0)).toHaveLength(1);
    });

    it('makes a fading light rise again from where it is, at the usual speed', () => {
      const now = PEAK_END + 300;
      const level = levelAt(now);
      const [again] = addTopLights(red, ['#ff0000'], now);
      expect(again.id).toBe(red[0].id);
      // Same brightness now, on its way up again...
      expect(levelAt(now - again.start)).toBeCloseTo(level);
      expect(now - again.start).toBeLessThan(RISE_MS);
      // ...to the same peak, which it reaches as fast as a new light would from there
      expect(levelAt(now + (1 - level) * RISE_MS - again.start)).toBeCloseTo(1);
    });

    it('keeps a light that rose again longer than the first one', () => {
      const [again] = addTopLights(red, ['#ff0000'], PEAK_END + 300);
      expect(pruneTopLights([again], TOP_LIGHT_MS)).toHaveLength(1);
    });
  });
});

describe('pruneTopLights', () => {
  it('drops the lights that have gone out', () => {
    const lights = addTopLights([], ['#ff0000'], 0);
    expect(pruneTopLights(lights, TOP_LIGHT_MS - 1)).toHaveLength(1);
    expect(pruneTopLights(lights, TOP_LIGHT_MS)).toEqual([]);
  });
});
