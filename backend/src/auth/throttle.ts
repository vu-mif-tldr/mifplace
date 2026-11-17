const MINUTE = 60 * 1000;

// Counts wrong passwords per key, in memory: after `max` failures within `windowMs` the key is
// blocked until the oldest of them leaves the window. Slows down guessing without locking an
// account for good. A restart forgets the counts.
export class FailureThrottle {
  private readonly failures = new Map<string, number[]>();
  private lastPrune = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {}

  blocked(key: string, now: number): boolean {
    this.prune(now);
    return this.recent(key, now).length >= this.max;
  }

  fail(key: string, now: number): void {
    const times = this.recent(key, now);
    times.push(now);
    this.failures.set(key, times);
  }

  // A successful sign-in starts the count again.
  clear(key: string): void {
    this.failures.delete(key);
  }

  // Takes back one fail(): the attempt counted at that time turned out right.
  undo(key: string, time: number): void {
    const times = this.failures.get(key);
    const i = times?.lastIndexOf(time) ?? -1;
    if (i >= 0) times!.splice(i, 1);
  }

  private recent(key: string, now: number): number[] {
    return (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
  }

  // Drops keys without recent failures, at most every 10 minutes.
  private prune(now: number): void {
    if (now - this.lastPrune < 10 * MINUTE) return;
    this.lastPrune = now;
    for (const key of this.failures.keys()) {
      if (this.recent(key, now).length === 0) this.failures.delete(key);
    }
  }
}
