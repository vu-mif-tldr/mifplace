import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineAnnouncer } from './online.js';

describe('OnlineAnnouncer', () => {
  let count = 0;
  let sent: string[] = [];
  let announcer: OnlineAnnouncer;

  beforeEach(() => {
    vi.useFakeTimers();
    count = 0;
    sent = [];
    announcer = new OnlineAnnouncer(
      { intervalMs: 1000 },
      () => count,
      (data) => sent.push(data)
    );
  });
  afterEach(() => {
    announcer.close();
    vi.useRealTimers();
  });

  it('sends the count once per interval, however many changes came', () => {
    count = 1;
    announcer.changed();
    count = 3;
    announcer.changed();
    vi.advanceTimersByTime(999);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['{"type":"online","count":3}']);
  });

  it('sends nothing when the count is back where it was', () => {
    count = 2;
    announcer.changed();
    vi.advanceTimersByTime(1000);
    count = 3;
    announcer.changed();
    count = 2;
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(['{"type":"online","count":2}']);
  });

  it('sends nothing after close', () => {
    count = 1;
    announcer.changed();
    announcer.close();
    announcer.changed();
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
  });
});
