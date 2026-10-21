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
import { startThrottleProxy } from './throttle-proxy.ts';

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
  /** T3: connections the server drops at random every second. 0 = off. */
  dropPerSecond: number;
  /** T4: the second of the measurement window at which the server process exits. 0 = off. */
  restartAtS: number;
  /** T5: extra viewers that read through a throttling proxy. 0 = off. */
  slowViewers: number;
  /** T5: how fast the slow viewers read, in bytes per second. */
  slowReadBytesPerSecond: number;
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
  dropPerSecond: 0,
  restartAtS: 0,
  slowViewers: 0,
  slowReadBytesPerSecond: 1_000,
};

export interface LoadHooks {
  /** How T4 restarts the server. Default: POST /api/debug/exit, and Docker starts it again. */
  restartServer(url: string): Promise<void>;
}

/** T2 is T1 with more viewers, so it has no scenario of its own. */
export type Scenario = 't1' | 't3' | 't4' | 't5';

// Thresholds from ADR-0003.
const TARGET_P95_MS = 1_000;
const HARD_LIMIT_P95_MS = 5_000;
const CATCH_UP_LIMIT_S = 30;
// Above this the load tool itself is too busy and its latencies are not trustworthy.
const OVERLOADED_LOOP_MS = 50;
// One thread keeps up with about 2,000 long polls per second (200 viewers) only just, so keep
// well below that. WebSocket viewers are much cheaper, but one rule for all keeps runs comparable.
const VIEWERS_PER_WORKER = 100;
// How long T4 waits for the server to come back and for every viewer to catch up.
const RESTART_WATCH_MS = 60_000;

type Sample = ServerMetrics & { t: number };

export interface ViewerGroup {
  viewers: number;
  openAtEnd: number;
  failed: number;
  /** Viewers that never received the last events. */
  behind: number;
  stats: LiveCanvasStats;
  /** Server event time to viewer receive time, ms, over the measurement window. */
  delivery: HistogramSummary;
  /** Time without an open connection, ms, one sample per outage. */
  outages: HistogramSummary;
}

export interface LoadReport {
  startedAt: string;
  scenario: Scenario;
  options: LoadOptions;
  environment: {
    loadToolNode: string;
    serverNode: string;
    server: ServerMetrics['settings'];
    cpus: number;
  };
  connect: { viewers: number; open: number; failed: number; seconds: number };
  /** The ordinary viewers, without the slow ones of T5. */
  viewers: ViewerGroup & { eventsInWindow: number };
  placements: { sent: number; failed: number; perSecond: number; rttMs: HistogramSummary };
  server: {
    cpuPercent: { avg: number; max: number };
    /** The highest per-second p99: shows short overloads that a whole-window p99 hides. */
    eventLoopWorstSecondP99Ms: number;
    rssMb: { atStart: number; max: number };
    heapUsedMbMax: number;
    perSecond: {
      messages: number;
      batches: number;
      placeRequests: number;
      lp: number;
      poll: number;
    };
    totals: { slowClientsDropped: number; pingTimeouts: number; errors: number };
    restarts: number;
    /** Seconds in which /api/metrics did not answer (the server was down). */
    missedSamples: number;
    samples: Sample[];
  };
  generator: {
    threads: number;
    cpuPercent: { avg: number; max: number };
    /** Over the whole window, ms. For the viewers: the worst thread. */
    mainEventLoopMs: { p99: number; max: number };
    viewerEventLoopMs: { p99: number; max: number };
  };
  /** T3 */
  drops?: { requested: number; applied: number };
  /** T4: seconds from the exit until the server answered, and until every viewer caught up. */
  restart?: { downS: number | null; allCaughtUpS: number | null; targetId: number | null };
  /** T5 */
  slow?: ViewerGroup & { readBytesPerSecond: number };
  verdict: {
    scenario: Scenario;
    result: 'pass' | 'fail' | 'inconclusive' | 'not applicable';
    checks: Record<string, boolean>;
    deliveryP95Ms: number;
    deliveryP95WithinHardLimit: boolean;
  };
  warnings: string[];
}

/** One load run: connect the viewers, warm up, measure, then check that nobody lost events. */
export async function runLoad(
  options: LoadOptions,
  log: (line: string) => void = () => {},
  hooks: Partial<LoadHooks> = {}
): Promise<LoadReport> {
  const scenario = scenarioOf(options);
  const restartServer = hooks.restartServer ?? exitServer;
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  const threads =
    options.workers > 0
      ? options.workers
      : Math.min(
          Math.ceil(options.viewers / VIEWERS_PER_WORKER),
          Math.max(1, availableParallelism() - 1)
        );
  const initial = await waitForServer(options.url);
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
  const proxy =
    options.slowViewers > 0
      ? await startThrottleProxy(options.url, options.slowReadBytesPerSecond)
      : null;
  // Slow viewers stream through the proxy but load the snapshot directly: T5 is about how the
  // server buffers the stream. Nobody waits for them; they settle during the warm-up.
  const slowPool =
    proxy === null
      ? null
      : new ViewerPool({
          url: proxy.url,
          snapshotUrl: options.url,
          transport: options.transport,
          viewers: options.slowViewers,
          rampPerSecond: options.rampPerSecond,
          client: options.client,
        });
  const allPools = slowPool === null ? pools : [...pools, slowPool];
  const sum = (key: 'open' | 'failed' | 'caughtUp') =>
    pools.reduce((total, pool) => total + pool.progress[key], 0);

  const connectTimeoutMs =
    (options.viewers / options.rampPerSecond + options.connectTimeoutS) * 1_000;
  const allSettled = await until(
    () => sum('open') + sum('failed') >= options.viewers,
    connectTimeoutMs
  );
  const connect = {
    viewers: options.viewers,
    open: sum('open'),
    failed: sum('failed'),
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
  if (!(await until(() => writer.state === 'open', 10_000))) {
    throw new Error('the writer did not connect');
  }
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

  for (const pool of allPools) pool.send({ t: 'measure' });
  measuring = true;
  rtt = new Histogram();
  // Also starts the server's first measurement interval.
  const first = await fetchMetrics(options.url);
  generator.sample();
  // A second sampler that is read only at the end, for an event loop p99 over the whole window.
  const generatorWindow = new ProcessSampler();
  const samples: Sample[] = [];
  const generatorSamples: ProcessSample[] = [];
  const drops = { requested: 0, applied: 0 };
  let dropsOwed = 0;
  let missedSamples = 0;
  let restartWatch: Promise<NonNullable<LoadReport['restart']>> | null = null;

  /** T4: restart the server, then time how long until it answers and everyone caught up. */
  async function watchRestart(): Promise<NonNullable<LoadReport['restart']>> {
    const before = await fetchStats(options.url);
    const exitAt = performance.now();
    log('restarting the server');
    await restartServer(options.url);
    const deadline = exitAt + RESTART_WATCH_MS;
    let after: Stats | null = null;
    while (after === null && performance.now() < deadline) {
      const stats = await fetchStats(options.url).catch(() => null);
      // The same address answers again, but it has to be a new process.
      if (stats !== null && stats.startedAt !== before.startedAt) after = stats;
      else await sleep(100);
    }
    if (after === null) return { downS: null, allCaughtUpS: null, targetId: null };
    const downS = round((performance.now() - exitAt) / 1_000);
    log(`the server is back after ${downS} s`);
    for (const pool of pools) pool.send({ t: 'target', id: after.lastEventId });
    const caughtUp = await until(
      () => sum('caughtUp') >= options.viewers,
      deadline - performance.now()
    );
    const allCaughtUpS = caughtUp ? round((performance.now() - exitAt) / 1_000) : null;
    log(caughtUp ? `every viewer caught up after ${allCaughtUpS} s` : 'not every viewer caught up');
    return { downS, allCaughtUpS, targetId: after.lastEventId };
  }

  log(`measuring for ${options.durationS} s`);
  const windowStart = performance.now();
  for (let second = 1; second <= options.durationS; second++) {
    await sleep(windowStart + second * 1_000 - performance.now());
    if (options.dropPerSecond > 0) {
      dropsOwed += options.dropPerSecond;
      const count = Math.floor(dropsOwed);
      dropsOwed -= count;
      drops.requested += count;
      drops.applied += await dropConnections(options.url, count).catch(() => 0);
    }
    if (second === options.restartAtS) {
      restartWatch = watchRestart();
      // Awaited after the window; until then a failure must not count as unhandled.
      restartWatch.catch(() => {});
    }
    try {
      samples.push({ t: second, ...(await fetchMetrics(options.url)) });
    } catch {
      missedSamples++;
    }
    generatorSamples.push(generator.sample());
    const sample = samples.at(-1);
    if (second % 10 === 0 && sample !== undefined) {
      log(
        `${second} s: server cpu ${sample.cpuPercent}%, loop p99 ${sample.eventLoopMs.p99} ms, ` +
          `rss ${sample.rssMb} MB; viewers open ${sum('open')}`
      );
    }
  }
  const windowS = (performance.now() - windowStart) / 1_000;
  measuring = false;
  const mainEventLoopMs = generatorWindow.sample().eventLoopMs;
  generatorWindow.stop();
  // A viewer counts as caught up after a restart only once it has a fresh event, so the writer
  // keeps placing (uncounted) until every viewer did or the watch gave up.
  const restart = restartWatch === null ? undefined : await restartWatch;
  clearInterval(writerTimer);

  // Let the last placements come back, then wait until every viewer has the last event.
  await sleep(200);
  const final = await waitForServer(options.url);
  for (const pool of allPools) {
    pool.send({ t: 'finish', targetId: final.lastEventId, drainMs: options.drainMs });
  }
  const reports = await Promise.all(pools.map((pool) => pool.report));
  const slowReports = slowPool === null ? [] : [await slowPool.report];
  await Promise.all(allPools.map((pool) => pool.terminate()));
  await proxy?.close();
  writer.stop();
  generator.stop();

  const viewers = summarize(reports);
  const slow = summarize(slowReports);
  const window = [first, ...samples];
  const everything = [...window, final];
  const perSecond = (pick: (m: ServerMetrics) => number) => round(growth(window, pick) / windowS);
  const totals = {
    slowClientsDropped: growth(everything, (m) => m.counters.slowClientsDropped),
    pingTimeouts: growth(everything, (m) => m.counters.pingTimeouts),
    errors: growth(everything, (m) => m.counters.errors),
  };
  const restarts = everything.filter(
    (m, i) => i > 0 && m.startedAt !== everything[i - 1].startedAt
  ).length;
  const viewerEventLoopMs = {
    p99: max([...reports, ...slowReports].map((report) => report.eventLoop.p99)),
    max: max([...reports, ...slowReports].map((report) => report.eventLoop.max)),
  };
  const generatorCpu = generatorSamples.map((sample) => sample.cpuPercent);

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
  if (viewers.negative > 0) {
    warnings.push(
      `${viewers.negative} of ${viewers.group.delivery.count} latencies were negative ` +
        `(counted as 0): ` +
        `the server's and the load tool's clocks differ, because they run on different machines ` +
        `or the clock was adjusted during the run`
    );
  }
  if (sent < 0.9 * options.rate * windowS && scenario !== 't4') {
    warnings.push(
      `the writer placed only ${round(sent / windowS)} of ${options.rate} pixels per second`
    );
  }

  const report: Omit<LoadReport, 'verdict'> = {
    startedAt,
    scenario,
    options,
    environment: {
      loadToolNode: process.version,
      serverNode: initial.node,
      server: initial.settings,
      cpus: availableParallelism(),
    },
    connect,
    viewers: { ...viewers.group, eventsInWindow: growth(window, (m) => m.lastEventId) },
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
      rssMb: { atStart: first.rssMb, max: max(samples.map((s) => s.rssMb)) },
      heapUsedMbMax: max(samples.map((s) => s.heapUsedMb)),
      perSecond: {
        messages: perSecond((m) => m.counters.messages),
        batches: perSecond((m) => m.counters.batches),
        placeRequests: perSecond((m) => m.requests.place),
        lp: perSecond((m) => m.requests.lp),
        poll: perSecond((m) => m.requests.poll),
      },
      totals,
      restarts,
      missedSamples,
      samples,
    },
    generator: {
      threads: threads + (slowPool === null ? 0 : 1),
      cpuPercent: { avg: avg(generatorCpu), max: max(generatorCpu) },
      mainEventLoopMs,
      viewerEventLoopMs,
    },
    ...(scenario === 't3' ? { drops } : {}),
    ...(restart === undefined ? {} : { restart }),
    ...(scenario === 't5'
      ? { slow: { ...slow.group, readBytesPerSecond: options.slowReadBytesPerSecond } }
      : {}),
    warnings,
  };
  return { ...report, verdict: judge(report, viewers.p95) };
}

/** The pass conditions of ADR-0003 for the scenario that ran. */
function judge(report: Omit<LoadReport, 'verdict'>, p95: number): LoadReport['verdict'] {
  const { viewers, options, server } = report;
  const noLostEvents = viewers.behind === 0 && viewers.stats.gaps === 0;
  const allOpenAtEnd = viewers.openAtEnd === options.viewers;
  const withinTarget = p95 <= TARGET_P95_MS;
  let checks: Record<string, boolean>;
  let result: LoadReport['verdict']['result'] | null = null;

  switch (report.scenario) {
    case 't1':
      checks = {
        'p95 at most 1 s': withinTarget,
        'no lost events': noLostEvents,
        'all connected': report.connect.open === options.viewers && allOpenAtEnd,
      };
      break;
    case 't3': {
      const applied = report.drops?.applied ?? 0;
      checks = {
        'connections were dropped': applied > 0,
        'no lost events': noLostEvents,
        'caught up without reloading the snapshot': viewers.stats.resyncs === 0,
        'all connected again': allOpenAtEnd,
      };
      // Short polling holds no connection the server could drop.
      if (applied === 0) result = 'not applicable';
      break;
    }
    case 't4': {
      const caughtUpS = report.restart?.allCaughtUpS ?? null;
      checks = {
        'the server came back': report.restart?.downS !== null,
        'all caught up within 30 s': caughtUpS !== null && caughtUpS <= CATCH_UP_LIMIT_S,
        'no server errors': server.totals.errors === 0,
        'no lost events': noLostEvents,
        'all connected again': allOpenAtEnd,
      };
      break;
    }
    case 't5': {
      // With polling the client asks for each response, so a slow reader slows only itself.
      const pull = options.transport === 'lp' || options.transport === 'poll';
      const engaged = server.totals.slowClientsDropped + server.totals.pingTimeouts > 0;
      checks = {
        'others: p95 at most 1 s': withinTarget,
        'others: no lost events': noLostEvents,
        'slow viewers: no gaps': (report.slow?.stats.gaps ?? 0) === 0,
        'buffer limit engaged (push transports)': pull || engaged,
      };
      // The run may have been too short for the buffers to fill: not a failure, not a pass.
      const othersFine = Object.entries(checks).every(
        ([name, ok]) => ok || name.startsWith('buffer')
      );
      if (!pull && !engaged && othersFine) result = 'inconclusive';
      break;
    }
  }
  return {
    scenario: report.scenario,
    result: result ?? (Object.values(checks).every(Boolean) ? 'pass' : 'fail'),
    checks,
    deliveryP95Ms: p95,
    deliveryP95WithinHardLimit: p95 <= HARD_LIMIT_P95_MS,
  };
}

function scenarioOf(options: LoadOptions): Scenario {
  const chosen = [
    options.dropPerSecond > 0 && 't3',
    options.restartAtS > 0 && 't4',
    options.slowViewers > 0 && 't5',
  ].filter((scenario): scenario is Scenario => scenario !== false);
  if (chosen.length > 1) throw new Error(`run one scenario at a time, got ${chosen.join(', ')}`);
  if (options.restartAtS > options.durationS) {
    throw new Error('the restart must happen inside the measurement window');
  }
  return chosen[0] ?? 't1';
}

/** Adds up the reports of several worker threads. */
function summarize(reports: ViewerPoolReport[]) {
  const delivery = new Histogram();
  const outages = new Histogram();
  const stats = emptyStats();
  let viewers = 0;
  let openAtEnd = 0;
  let failed = 0;
  let behind = 0;
  for (const report of reports) {
    delivery.merge(report.latency);
    outages.merge(report.outages);
    addStats(stats, report.stats);
    viewers += report.viewers;
    openAtEnd += report.open;
    failed += report.failed;
    behind += report.behind;
  }
  const group: ViewerGroup = {
    viewers,
    openAtEnd,
    failed,
    behind,
    stats,
    delivery: delivery.summary(),
    outages: outages.summary(),
  };
  return { group, p95: delivery.percentile(95), negative: delivery.negative };
}

/**
 * How much a server counter grew over consecutive samples. A restart sets the counters back to
 * 0, so after one the new value is all growth.
 */
function growth(samples: ServerMetrics[], pick: (m: ServerMetrics) => number): number {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const restarted = samples[i].startedAt !== samples[i - 1].startedAt;
    total += restarted ? pick(samples[i]) : pick(samples[i]) - pick(samples[i - 1]);
  }
  return total;
}

/** A worker thread with a share of the viewers. */
class ViewerPool {
  progress = { started: 0, open: 0, failed: 0, caughtUp: 0 };
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

interface Stats {
  startedAt: string;
  lastEventId: number;
}

async function fetchJson<T>(url: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, url), init);
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Resets the server's measurement interval: only the sampling loop may call it. */
function fetchMetrics(url: string): Promise<ServerMetrics> {
  return fetchJson(url, '/api/metrics');
}

/** For liveness checks: does not touch the server's measurement interval. */
function fetchStats(url: string): Promise<Stats> {
  return fetchJson(url, '/api/stats');
}

async function dropConnections(url: string, count: number): Promise<number> {
  if (count === 0) return 0;
  const { dropped } = await fetchJson<{ dropped: number }>(url, `/api/debug/drop?count=${count}`, {
    method: 'POST',
  });
  return dropped;
}

async function exitServer(url: string): Promise<void> {
  const response = await fetch(new URL('/api/debug/exit', url), { method: 'POST' });
  if (response.status !== 202) {
    throw new Error('the server does not allow /api/debug/exit; start it with --allow-exit 1');
  }
}

/** The server may still be starting (a fresh or restarted container), so retry for a while. */
async function waitForServer(url: string): Promise<ServerMetrics> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      return await fetchMetrics(url);
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
