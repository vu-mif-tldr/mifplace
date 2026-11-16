import {
  BLOOM_EFFECTS,
  BLOOM_MS,
  MAX_BATCH_FOR_BLOOMS,
  MAX_BLOOMS,
  addBlooms,
  bloomLifetime,
  pruneBlooms,
} from './blooms';

const pixel = (x: number) => ({ x, y: 1, color: '#ff0000' });

describe('addBlooms', () => {
  it('adds one bloom per pixel with a new id and the arrival time', () => {
    const blooms = addBlooms([], [pixel(1), pixel(2)], 1000);
    expect(blooms.map((b) => [b.x, b.born])).toEqual([
      [1, 1000],
      [2, 1000],
    ]);
    expect(blooms[0].id).not.toBe(blooms[1].id);
  });

  it('drops the blooms whose animation is over', () => {
    const first = addBlooms([], [pixel(1)], 0);
    const next = addBlooms(first, [pixel(2)], BLOOM_MS);
    expect(next.map((b) => b.x)).toEqual([2]);
  });

  it('adds nothing for a catch-up batch, but still drops the old ones', () => {
    const first = addBlooms([], [pixel(1)], 0);
    const big = Array.from({ length: MAX_BATCH_FOR_BLOOMS + 1 }, (_, i) => pixel(i));
    expect(addBlooms(first, big, 10)).toEqual(first);
    expect(addBlooms(first, big, BLOOM_MS)).toEqual([]);
  });

  it('keeps only the newest MAX_BLOOMS', () => {
    let blooms = addBlooms([], [], 0);
    for (let i = 0; i < MAX_BLOOMS + 5; i++) blooms = addBlooms(blooms, [pixel(i)], i);
    expect(blooms).toHaveLength(MAX_BLOOMS);
    expect(blooms[blooms.length - 1].x).toBe(MAX_BLOOMS + 4);
  });
});

describe('pruneBlooms', () => {
  it('keeps a bloom until BLOOM_MS has passed', () => {
    const blooms = addBlooms([], [pixel(1)], 0);
    expect(pruneBlooms(blooms, BLOOM_MS - 1)).toHaveLength(1);
    expect(pruneBlooms(blooms, BLOOM_MS)).toHaveLength(0);
  });
});

describe('bloomLifetime', () => {
  const off = {
    glow: { ...BLOOM_EFFECTS.glow, enabled: false, ms: 2000 },
    ring: { ...BLOOM_EFFECTS.ring, enabled: false, ms: 1000, waves: 3, gapMs: 300 },
  };

  it('is the longest of the effects that are on, rings with their delays', () => {
    expect(bloomLifetime({ ...off, ring: { ...off.ring, enabled: true } })).toBe(1600);
    expect(bloomLifetime({ ...off, glow: { ...off.glow, enabled: true } })).toBe(2000);
  });

  it('is zero when every effect is off', () => {
    expect(bloomLifetime(off)).toBe(0);
  });
});
