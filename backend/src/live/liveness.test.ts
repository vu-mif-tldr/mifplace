import { describe, expect, it, vi } from 'vitest';
import { LivenessTracker, startLivenessCheck } from './liveness.js';

describe('LivenessTracker', () => {
  it('does not ping an active connection', () => {
    const tracker = new LivenessTracker({
      idleMs: 15000,
      pongTimeoutMs: 10000,
    });

    tracker.touch(1, 0);

    expect(tracker.check(14000)).toEqual({
      ping: [],
      terminate: [],
    });
  });

  it('pings once after 15 seconds of inactivity', () => {
    const tracker = new LivenessTracker({
      idleMs: 15000,
      pongTimeoutMs: 10000,
    });

    tracker.touch(1, 0);

    expect(tracker.check(15000).ping).toEqual([1]);
    expect(tracker.check(20000).ping).toEqual([]);
  });

  it('pings again after a pong and another idle period', () => {
    const tracker = new LivenessTracker({
      idleMs: 15000,
      pongTimeoutMs: 10000,
    });

    tracker.touch(1, 0);

    expect(tracker.check(15000).ping).toEqual([1]);

    // Browser responds to the ping.
    tracker.touch(1, 16000);

    // The connection is active again.
    expect(tracker.check(20000).ping).toEqual([]);

    // After another 15 seconds of silence, ping again.
    expect(tracker.check(31000).ping).toEqual([1]);
  });

  it('cancels termination when a pong arrives', () => {
    const tracker = new LivenessTracker({
      idleMs: 15000,
      pongTimeoutMs: 10000,
    });

    tracker.touch(1, 0);
    tracker.check(15000);

    tracker.touch(1, 20000);

    expect(tracker.check(25000)).toEqual({
      ping: [],
      terminate: [],
    });
  });

  it('terminates a connection that does not answer ping', () => {
    const tracker = new LivenessTracker({
      idleMs: 15000,
      pongTimeoutMs: 10000,
    });

    tracker.touch(1, 0);
    tracker.check(15000);

    expect(tracker.check(25000).terminate).toEqual([1]);
    expect(tracker.check(30000).terminate).toEqual([]);
  });

  it('forgets a closed connection', () => {
    const tracker = new LivenessTracker({
      idleMs: 15000,
      pongTimeoutMs: 10000,
    });

    tracker.touch(1, 0);
    tracker.forget(1);

    expect(tracker.check(30000).ping).toEqual([]);
  });
});

describe('startLivenessCheck', () => {
  it('runs checks on a timer and stops checking', () => {
    vi.useFakeTimers();

    try {
      const tracker = new LivenessTracker({
        idleMs: 15000,
        pongTimeoutMs: 10000,
      });

      const ping = vi.fn();
      const terminate = vi.fn();

      tracker.touch(1, 0);

      const checker = startLivenessCheck({
        intervalMs: 5000,
        tracker,
        ping,
        terminate,
        now: () => Date.now(),
      });

      vi.advanceTimersByTime(15000);
      expect(ping).toHaveBeenCalledWith(1);

      vi.advanceTimersByTime(10000);
      expect(terminate).toHaveBeenCalledWith(1);

      checker.stop();

      expect(terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
