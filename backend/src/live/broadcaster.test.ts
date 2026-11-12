import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Broadcaster } from './broadcaster.js';

const start = { eventId: 10, timestamp: 1000 };

describe('Broadcaster', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends nothing while nothing is published', () => {
    const send = vi.fn();
    new Broadcaster({ batchMs: 100 }, send, start);

    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends several published events as one pixels message after batchMs', () => {
    const send = vi.fn();
    const broadcaster = new Broadcaster({ batchMs: 100 }, send, start);

    broadcaster.publish({ eventId: 11, pos: 4, colorId: 12, timestamp: 1100 });
    broadcaster.publish({ eventId: 12, pos: 5, colorId: 5, timestamp: 1200 });
    vi.advanceTimersByTime(99);
    expect(send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    // The format of docs/api.md, with the checkpoint of the last event in the batch
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      type: 'pixels',
      pixels: [
        [11, 4, 12],
        [12, 5, 5],
      ],
      eventId: 12,
      timestamp: 1200,
    });
  });

  it('moves lastSent only when a batch is sent', () => {
    const broadcaster = new Broadcaster({ batchMs: 100 }, () => {}, start);
    expect(broadcaster.lastSent).toEqual(start);

    broadcaster.publish({ eventId: 11, pos: 4, colorId: 12, timestamp: 1100 });
    expect(broadcaster.lastSent).toEqual(start);

    vi.advanceTimersByTime(100);
    expect(broadcaster.lastSent).toEqual({ eventId: 11, timestamp: 1100 });
  });

  it('starts a new batch with the first publish after the previous one was sent', () => {
    const send = vi.fn();
    const broadcaster = new Broadcaster({ batchMs: 100 }, send, start);

    broadcaster.publish({ eventId: 11, pos: 4, colorId: 12, timestamp: 1100 });
    vi.advanceTimersByTime(100);
    // Published 30 ms after the first batch went out: it is sent batchMs later, not at once
    vi.advanceTimersByTime(30);
    broadcaster.publish({ eventId: 12, pos: 5, colorId: 5, timestamp: 1230 });
    vi.advanceTimersByTime(99);
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[1][0]).pixels).toEqual([[12, 5, 5]]);
  });

  it('close stops the timer and drops the pending events', () => {
    const send = vi.fn();
    const broadcaster = new Broadcaster({ batchMs: 100 }, send, start);

    broadcaster.publish({ eventId: 11, pos: 4, colorId: 12, timestamp: 1100 });
    broadcaster.close();
    // A publish after close must not start the timer again
    broadcaster.publish({ eventId: 12, pos: 5, colorId: 5, timestamp: 1200 });

    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
    expect(broadcaster.lastSent).toEqual(start);
  });
});
