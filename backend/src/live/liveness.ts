export const DEFAULT_IDLE_MS = 15_000;
export const DEFAULT_PONG_TIMEOUT_MS = 10_000;
export const DEFAULT_CHECK_INTERVAL_MS = 5_000;

type ConnectionState = {
  lastActivity: number;
  pingedAt?: number;
};

export class LivenessTracker {
  private readonly connections = new Map<number, ConnectionState>();

  constructor(
    private readonly options: {
      idleMs: number;
      pongTimeoutMs: number;
    }
  ) {}

  touch(id: number, now: number): void {
    this.connections.set(id, { lastActivity: now });
  }

  forget(id: number): void {
    this.connections.delete(id);
  }

  check(now: number): { ping: number[]; terminate: number[] } {
    const ping: number[] = [];
    const terminate: number[] = [];

    for (const [id, state] of this.connections) {
      if (state.pingedAt !== undefined) {
        if (now - state.pingedAt >= this.options.pongTimeoutMs) {
          terminate.push(id);
          this.forget(id);
        }
      } else if (now - state.lastActivity >= this.options.idleMs) {
        ping.push(id);
        state.pingedAt = now;
      }
    }

    return { ping, terminate };
  }
}

export function startLivenessCheck(options: {
  intervalMs: number;
  tracker: LivenessTracker;
  ping(id: number): void;
  terminate(id: number): void;
  now?: () => number;
}): { stop(): void } {
  const now = options.now ?? Date.now;

  const timer = setInterval(() => {
    const result = options.tracker.check(now());

    for (const id of result.ping) {
      options.ping(id);
    }

    for (const id of result.terminate) {
      options.terminate(id);
    }
  }, options.intervalMs);

  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}
