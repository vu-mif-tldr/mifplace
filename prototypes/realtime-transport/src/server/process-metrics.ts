import { monitorEventLoopDelay } from 'node:perf_hooks';

export interface ProcessSample {
  /** CPU time of the whole process (all threads) as a share of one core, in %. */
  cpuPercent: number;
  /** Event loop delay of the calling thread, in ms. Grows when the thread is overloaded. */
  eventLoopMs: { p50: number; p99: number; max: number };
  rssMb: number;
  heapUsedMb: number;
}

const LOOP_RESOLUTION_MS = 10;

/** Measures the process between two calls of sample(). Used by the server and the load tool. */
export class ProcessSampler {
  private readonly loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  private lastCpu = process.cpuUsage();
  private lastAt = performance.now();

  constructor() {
    this.loop.enable();
  }

  /** Values since the previous call (or since construction), then starts a new interval. */
  sample(): ProcessSample {
    const now = performance.now();
    const cpu = process.cpuUsage(this.lastCpu);
    const memory = process.memoryUsage();
    // The histogram measures the time between its own timer ticks, so even an idle loop reports
    // about the resolution. Subtracting it leaves the delay itself.
    const ms = (ns: number) => round(Math.max(0, ns / 1e6 - LOOP_RESOLUTION_MS));
    const empty = this.loop.count === 0;
    const result: ProcessSample = {
      cpuPercent: round(((cpu.user + cpu.system) / 1_000 / (now - this.lastAt)) * 100),
      eventLoopMs: {
        p50: empty ? 0 : ms(this.loop.percentile(50)),
        p99: empty ? 0 : ms(this.loop.percentile(99)),
        max: empty ? 0 : ms(this.loop.max),
      },
      rssMb: round(memory.rss / 1e6),
      heapUsedMb: round(memory.heapUsed / 1e6),
    };
    this.loop.reset();
    this.lastCpu = process.cpuUsage();
    this.lastAt = now;
    return result;
  }

  stop(): void {
    this.loop.disable();
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
