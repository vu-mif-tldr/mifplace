import { TOP_LIGHT_MS } from './topLights';
import { useTopLights } from './useTopLights';

describe('useTopLights', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('adds lights and drops them once they have gone out', () => {
    let time = 0;
    const { lights, add } = useTopLights(() => time);
    add(['#ff0000']);
    expect(lights.value).toHaveLength(1);

    time = TOP_LIGHT_MS + 50;
    vi.advanceTimersByTime(TOP_LIGHT_MS + 50);
    expect(lights.value).toHaveLength(0);
  });
});
