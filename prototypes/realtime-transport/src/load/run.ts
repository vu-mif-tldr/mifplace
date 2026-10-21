import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { LiveCanvas, type LiveCanvasStats } from '../client/live-canvas.ts';
import { sleep } from '../client/transports.ts';
import type { ServerMetrics } from '../server/app.ts';
import { ProcessSampler, type ProcessSample } from '../server/process-metrics.ts';
import { CANVAS_HEIGHT, CANVAS_WIDTH, PALETTE, type TransportName } from '../shared/protocol.ts';
import {
  addStats,
  emptyStats,
  type ClientOptions,
  type FromViewers,
  type ToViewers,
  type ViewerPoolConfig,
  type ViewerPoolReport,
} from './common.ts';
import { Histogram, type HistogramSummary } from './histogram.ts';

export interface LoadOptions {
  url: string;
  transport: TransportName;
  /** Passive connections that only receive. */
  viewers: number;
  /** Placements per second, made by one extra client (the writer) through the real write path. */
  rate: number;
  /** New viewer connections per second while connecting. */
  rampPerSecond: number;
  warmupS: number;
  durationS: number;
  /** Worker threads for the viewers; 0 = one per 100 viewers, at most one per spare CPU. */
  workers: number;
  /** How long viewers may take to receive the last events after the writer stops. */
  drainMs: number;
  connectTimeoutS: number;
  client: ClientOptions;
}

export const DEFAULT_LOAD_OPTIONS: LoadOptions = {
  url: 'http://127.0.0.1:3100',
  transport: 'ws',
  viewers: 500,
  rate: 30,
  rampPerSecond: 100,
  warmupS: 10,
  durationS: 60,
  workers: 0,
  drainMs: 5_000,
  connectTimeoutS: 30,
  client: {},
};

// The thresholds of test T1 in ADR-0003.
const TARGET_P95_MS = 1_000;
const HARD_LIMIT_P95_MS = 5_000;
// Above this the load tool itself is too busy and its latencies are not trustworthy.
const OVERLOADED_LOOP_MS = 50;
// One thread keeps up with about 2,000 long polls per second (200 viewers) only just, so keep
// well below that. WebSocket viewers are much cheaper, but one rule for all keeps runs comparable.
const VIEWERS_PER_WORKER = 100;

type Sample = ServerMetrics & { t: number };

export interface LoadReport {
  startedAt: string;
  options: LoadOptions;
  connect: { viewers: number; open: number; failed: number; seconds: number };
  /** Server event time to viewer receive time, ms, over the measurement window. */
  delivery: HistogramSummary;
  correctness: LiveCanvasStats & {
    /** Viewers that never received the last events: lost events. */
    behind: number;
    openAtEnd: number;
    eventsInWindow: number;
  };
  placements: { sent: number; failed: number; perSecond: number; rttMs: HistogramSummary };
  server: {
    cpuPercent: { avg: number; max: number };
    /** The highest per-second p99: shows short overloads that a whole-window p99 hides. */
    eventLoopWorstSecondP99Ms: number;
    rssMbMax: number;
    heapUsedMbMax: number;
    perSecond: {
      messages: number;
      batches: number;
      placeRequests: number;
      lp: number;
      poll: number;
    };
    slowClientsDropped: number;
    samples: Sample[];
  };
  generator: {
    threads: number;
    cpuPercent: { avg: number; max: number };
    /** Over the whole window, ms. For the viewers: the worst thread. */
    mainEventLoopMs: { p99: number; max: number };
    viewerEventLoopMs: { p99: number; max: number };
  };
  verdict: {
    deliveryP95Ms: number;
    withinTarget: boolean;
    withinHardLimit: boolean;
    noLostEvents: boolean;
    allConnected: boolean;
    t1: 'pass' | 'fail';
  };
  warnings: string[];
}

/** One load run: connect the viewers, warm up, measure, then check that nobody lost events. */
export async function runLoad(
  options: LoadOptions,
  log: (line: string) => void = () => {}
): Promise<LoadReport> {
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  const threads =
    options.workers > 0
      ? options.workers
      : Math.min(
          Math.ceil(options.viewers / VIEWERS_PER_WORKER),
          Math.max(1, availableParallelism() - 1)
        );
  await waitForServer(options.url);
  const generator = new ProcessSampler();

  log(`connecting ${options.viewers} ${options.transport} viewers in ${threads} worker thread(s)`);
  const connectStart = performance.now();
  const pools = split(options.viewers, threads).map(
    (viewers) =>
      new ViewerPool({
        url: options.url,
        transport: options.transport,
        viewers,
        rampPerSecond: options.rampPerSecond / threads,
        client: options.client,
      })
  );
  const progress = () => {
    const total = { open: 0, failed: 0 };
    for (const pool of pools) {
      total.open += pool.progress.open;
      total.failed += pool.progress.failed;
    }
    return total;
  };
  const connectTimeoutMs =
    (options.viewers / options.rampPerSecond + options.connectTimeoutS) * 1_000;
  const allSettled = await until(() => {
    const { open, failed } = progress();
    return open + failed >= options.viewers;
  }, connectTimeoutMs);
  const connect = {
    viewers: options.viewers,
    ...progress(),
    seconds: round((performance.now() - connectStart) / 1_000),
  };
  if (!allSettled) warnings.push(`only ${connect.open} of ${options.viewers} viewers connected`);
  log(`${connect.open} open, ${connect.failed} failed, in ${connect.seconds} s`);

  const writer = new LiveCanvas({
    baseUrl: options.url,
    transport: options.transport,
    ...options.client,
  });
  await writer.start();
  if (!(await until(() => writer.state === 'open', 10_000)))
    throw new Error('the writer did not connect');
  let measuring = false;
  let rtt = new Histogram();
  let sent = 0;
  let failedPlacements = 0;
  const writerTimer = setInterval(() => {
    const counted = measuring;
    const sentAt = performance.now();
    if (counted) sent++;
    void writer
      .place(random(CANVAS_WIDTH), random(CANVAS_HEIGHT), random(PALETTE.length))
      .then((result) => {
        if (!counted) return;
        if (result.ok) rtt.record(performance.now() - sentAt);
        else failedPlacements++;
      });
  }, 1_000 / options.rate);

  log(`warming up for ${options.warmupS} s`);
  await sleep(options.warmupS * 1_000);

  for (const pool of pools) pool.send({ t: 'measure' });
  measuring = true;
  rtt = new Histogram();
  // Also starts the server's first measurement interval.
  const first = await fetchMetrics(options.url);
  generator.sample();
  // A second sampler that is read only at the end, for an event loop p99 over the whole window.
  const generatorWindow = new ProcessSampler();
  const samples: Sample[] = [];
  const generatorSamples: ProcessSample[] = [];
  log(`measuring for ${options.durationS} s`);
  const windowStart = performance.now();
  for (let second = 1; second <= options.durationS; second++) {
    await sleep(windowStart + second * 1_000 - performance.now());
    const sample = { t: second, ...(await fetchMetrics(options.url)) };
    samples.push(sample);
    generatorSamples.push(generator.sample());
    if (second % 10 === 0) {
      log(
        `${second} s: server cpu ${sample.cpuPercent}%, loop p99 ${sample.eventLoopMs.p99} ms, ` +
          `rss ${sample.rssMb} MB; viewers open ${progress().open}`
      );
    }
  }
  const windowS = (performance.now() - windowStart) / 1_000;
  measuring = false;
  clearInterval(writerTimer);
  const mainEventLoopMs = generatorWindow.sample().eventLoopMs;
  generatorWindow.stop();

  // Let the last placements come back, then wait until every viewer has the last event.
  await sleep(200);
  const final = await fetchMetrics(options.url);
  for (const pool of pools)
    pool.send({ t: 'finish', targetId: final.lastEventId, drainMs: options.drainMs });
  const reports = await Promise.all(pools.map((pool) => pool.report));
  await Promise.all(pools.map((pool) => pool.terminate()));
  writer.stop();
  generator.stop();

  const delivery = new Histogram();
  const stats = emptyStats();
  let behind = 0;
  let openAtEnd = 0;
  for (const report of reports) {
    delivery.merge(report.latency);
    addStats(stats, report.stats);
    behind += report.behind;
    openAtEnd += report.open;
  }
  const last = samples.at(-1) ?? first;
  const perSecond = (end: number, start: number) => round((end - start) / windowS);
  const viewerEventLoopMs = {
    p99: max(reports.map((report) => report.eventLoop.p99)),
    max: max(reports.map((report) => report.eventLoop.max)),
  };
  const generatorCpu = generatorSamples.map((sample) => sample.cpuPercent);

  const deliveryP95Ms = delivery.percentile(95);
  const noLostEvents = behind === 0 && stats.gaps === 0;
  const allConnected = connect.open === options.viewers && openAtEnd === options.viewers;
  const withinTarget = deliveryP95Ms <= TARGET_P95_MS;

  const loopP99 = Math.max(viewerEventLoopMs.p99, mainEventLoopMs.p99);
  if (loopP99 > OVERLOADED_LOOP_MS) {
    warnings.push(
      `the load tool was overloaded (event loop p99 ${loopP99} ms): latencies are too high; ` +
        `use more --workers or fewer viewers`
    );
  }
  if (avg(generatorCpu) > 80 * availableParallelism()) {
    warnings.push('the load tool used more than 80% of all CPUs');
  }
  if (delivery.negative > 0) {
    warnings.push(
      `${delivery.negative} of ${delivery.count} latencies were negative (counted as 0): the ` +
        `server's and the load tool's clocks differ, because they run on different machines or ` +
        `the clock was adjusted during the run`
    );
  }
  if (sent < 0.9 * options.rate * windowS) {
    warnings.push(
      `the writer placed only ${round(sent / windowS)} of ${options.rate} pixels per second`
    );
  }

  return {
    startedAt,
    options,
    connect,
    delivery: delivery.summary(),
    correctness: {
      ...stats,
      behind,
      openAtEnd,
      eventsInWindow: last.lastEventId - first.lastEventId,
    },
    placements: {
      sent,
      failed: failedPlacements,
      perSecond: round(sent / windowS),
      rttMs: rtt.summary(),
    },
    server: {
      cpuPercent: {
        avg: avg(samples.map((s) => s.cpuPercent)),
        max: max(samples.map((s) => s.cpuPercent)),
      },
      eventLoopWorstSecondP99Ms: max(samples.map((s) => s.eventLoopMs.p99)),
      rssMbMax: max(samples.map((s) => s.rssMb)),
      heapUsedMbMax: max(samples.map((s) => s.heapUsedMb)),
      perSecond: {
        messages: perSecond(last.counters.messages, first.counters.messages),
        batches: perSecond(last.counters.batches, first.counters.batches),
        placeRequests: perSecond(last.requests.place, first.requests.place),
        lp: perSecond(last.requests.lp, first.requests.lp),
        poll: perSecond(last.requests.poll, first.requests.poll),
      },
      slowClientsDropped: final.counters.slowClientsDropped - first.counters.slowClientsDropped,
      samples,
    },
    generator: {
      threads,
      cpuPercent: { avg: avg(generatorCpu), max: max(generatorCpu) },
      mainEventLoopMs,
      viewerEventLoopMs,
    },
    verdict: {
      deliveryP95Ms,
      withinTarget,
      withinHardLimit: deliveryP95Ms <= HARD_LIMIT_P95_MS,
      noLostEvents,
      allConnected,
      t1: withinTarget && noLostEvents && allConnected ? 'pass' : 'fail',
    },
    warnings,
  };
}

/** A worker thread with a share of the viewers. */
class ViewerPool {
  progress = { started: 0, open: 0, failed: 0 };
  readonly report: Promise<ViewerPoolReport>;
  private readonly worker: Worker;

  constructor(config: ViewerPoolConfig) {
    this.worker = new Worker(new URL('./viewers.ts', import.meta.url), { workerData: config });
    this.report = new Promise((resolve, reject) => {
      this.worker.on('message', (message: FromViewers) => {
        if (message.t === 'progress') this.progress = message;
        else resolve(message.report);
      });
      this.worker.once('error', reject);
      this.worker.once('exit', (code) =>
        reject(new Error(`a viewer worker exited with code ${code}`))
      );
    });
    // Rejections are seen when the report is awaited; do not crash before that.
    this.report.catch(() => {});
  }

  send(message: ToViewers): void {
    this.worker.postMessage(message);
  }

  async terminate(): Promise<void> {
    await this.worker.terminate();
  }
}

async function fetchMetrics(url: string): Promise<ServerMetrics> {
  const response = await fetch(new URL('/api/metrics', url));
  if (!response.ok) throw new Error(`GET /api/metrics: HTTP ${response.status}`);
  return (await response.json()) as ServerMetrics;
}

/** The server may still be starting (a fresh container), so retry for a while. */
async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await fetchMetrics(url);
      return;
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`no prototype server at ${url}`, { cause: error });
      await sleep(250);
    }
  }
}

async function until(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
  return true;
}

/** Splits `total` into `parts` integers that differ by at most 1. */
function split(total: number, parts: number): number[] {
  return Array.from({ length: parts }, (_, i) => Math.floor((total + i) / parts));
}

function random(below: number): number {
  return Math.floor(Math.random() * below);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function avg(values: number[]): number {
  return values.length === 0
    ? 0
    : round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function max(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}
