import {
  ACTIVITY_WINDOW_MS,
  FULL_ENERGY_RATE,
  energyOf,
  pruneActivity,
  summarize,
} from './activity';

describe('pruneActivity', () => {
  it('keeps only the events inside the window', () => {
    const events = [{ at: 0 }, { at: 5000 }];
    expect(pruneActivity(events, ACTIVITY_WINDOW_MS)).toEqual([events[1]]);
  });
});

describe('summarize', () => {
  it('is quiet with nothing in the window', () => {
    expect(summarize([{ at: 0 }], ACTIVITY_WINDOW_MS)).toEqual({ rate: 0, energy: 0 });
  });

  it('counts pixels per minute over the window', () => {
    const events = Array.from({ length: 5 }, () => ({ at: 1000 }));
    // 5 pixels in 10 s are 30 per minute
    expect(summarize(events, 2000)).toEqual({ rate: 30, energy: energyOf(30) });
  });
});

describe('energyOf', () => {
  it('is 0 without pixels and 1 at the full rate and above', () => {
    expect(energyOf(0)).toBe(0);
    expect(energyOf(FULL_ENERGY_RATE)).toBe(1);
    expect(energyOf(FULL_ENERGY_RATE * 10)).toBe(1);
  });

  it('already gives some light to a few pixels', () => {
    expect(energyOf(30)).toBeGreaterThan(0.5);
    expect(energyOf(-5)).toBe(0);
  });
});
