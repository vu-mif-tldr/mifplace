import { BLOOM_MS } from './blooms';
import { useBlooms } from './useBlooms';

const pixel = { x: 1, y: 2, color: '#ff0000' };

describe('useBlooms', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('adds blooms and drops them once their animation is over', () => {
    let time = 0;
    const { blooms, add } = useBlooms({ matches: false }, () => time);
    add([pixel]);
    expect(blooms.value).toHaveLength(1);

    time = BLOOM_MS + 50;
    vi.advanceTimersByTime(BLOOM_MS + 50);
    expect(blooms.value).toHaveLength(0);
  });

  it('adds nothing with reduced motion', () => {
    const { blooms, add } = useBlooms({ matches: true }, () => 0);
    add([pixel]);
    expect(blooms.value).toHaveLength(0);
  });
});
