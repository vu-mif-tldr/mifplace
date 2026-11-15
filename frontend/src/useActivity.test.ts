import { effectScope } from 'vue';
import { ACTIVITY_WINDOW_MS } from './activity';
import { MAX_BATCH_FOR_BLOOMS } from './blooms';
import { ACTIVITY_REFRESH_MS, useActivity } from './useActivity';

const pixel = { x: 3, y: 4, color: '#00a2e8' };

describe('useActivity', () => {
  let time = 0;
  beforeEach(() => {
    time = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  function activity() {
    const scope = effectScope();
    const result = scope.run(() => useActivity(() => time))!;
    return { ...result, stop: () => scope.stop() };
  }

  it('counts a batch at once and goes quiet when nothing more arrives', () => {
    const { summary, record, stop } = activity();
    record([pixel, pixel]);
    expect(summary.value.rate).toBe(12);

    time = ACTIVITY_WINDOW_MS;
    vi.advanceTimersByTime(ACTIVITY_REFRESH_MS);
    expect(summary.value.rate).toBe(0);
    stop();
  });

  it('ignores empty and catch-up batches', () => {
    const { summary, record, stop } = activity();
    record([]);
    record(Array.from({ length: MAX_BATCH_FOR_BLOOMS + 1 }, () => pixel));
    expect(summary.value.rate).toBe(0);
    stop();
  });

  it('stops counting when its scope ends', () => {
    const { stop } = activity();
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
