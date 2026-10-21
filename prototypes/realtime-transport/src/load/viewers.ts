import { parentPort, workerData } from 'node:worker_threads';
import { LiveCanvas } from '../client/live-canvas.ts';
import { sleep } from '../client/transports.ts';
import { ProcessSampler } from '../server/process-metrics.ts';
import {
  addStats,
  emptyStats,
  type FromViewers,
  type ToViewers,
  type ViewerPoolConfig,
} from './common.ts';
import { Histogram } from './histogram.ts';

// A worker thread of the load tool with its share of the passive viewers. They read and parse
// every message like a browser tab, through the same client code, but draw nothing: they count.

if (parentPort === null) throw new Error('viewers.ts runs as a worker thread of the load tool');
const port = parentPort;
const config = workerData as ViewerPoolConfig;
const viewers: LiveCanvas[] = [];
const sampler = new ProcessSampler();
let failed = 0;
let measuring = false;
let latency = new Histogram();
let outages = new Histogram();
let baseline = emptyStats();
/** Set after a server restart: the event id a viewer needs to count as caught up. */
let target = Infinity;
/**
 * Viewers that applied an event after `target` was set. Without this, a viewer that has not yet
 * noticed a restart which lost the log would count, because its old ids are higher than the new.
 */
let fresh = new Set<LiveCanvas>();

const post = (message: FromViewers) => port.postMessage(message);
const countOpen = () => viewers.filter((viewer) => viewer.state === 'open').length;
const countCaughtUp = () =>
  viewers.filter(
    (viewer) => viewer.state === 'open' && viewer.lastEventId >= target && fresh.has(viewer)
  ).length;

function totalStats() {
  const total = emptyStats();
  for (const viewer of viewers) addStats(total, viewer.stats);
  return total;
}

const progressTimer = setInterval(() => {
  post({
    t: 'progress',
    started: viewers.length,
    open: countOpen(),
    failed,
    caughtUp: countCaughtUp(),
  });
}, 250);

port.on('message', (message: ToViewers) => {
  switch (message.t) {
    case 'measure':
      measuring = true;
      latency = new Histogram();
      outages = new Histogram();
      baseline = totalStats();
      // Starts one interval that lasts the whole window: its p99 is over thousands of ticks.
      sampler.sample();
      break;
    case 'target':
      target = message.id;
      fresh = new Set();
      break;
    case 'finish':
      void finish(message.targetId, message.drainMs);
      break;
  }
});

async function finish(targetId: number, drainMs: number): Promise<void> {
  const deadline = Date.now() + drainMs;
  while (Date.now() < deadline && viewers.some((viewer) => viewer.lastEventId < targetId)) {
    await sleep(50);
  }
  const { p99, max } = sampler.sample().eventLoopMs;
  const stats = totalStats();
  addStats(stats, baseline, -1);
  const behind = viewers.filter((viewer) => viewer.lastEventId < targetId).length;
  const open = countOpen();
  for (const viewer of viewers) viewer.stop();
  clearInterval(progressTimer);
  sampler.stop();
  post({
    t: 'report',
    report: {
      viewers: viewers.length,
      open,
      failed,
      behind,
      stats,
      latency: latency.data(),
      outages: outages.data(),
      eventLoop: { p99, max },
    },
  });
}

async function ramp(): Promise<void> {
  const pauseMs = 1_000 / config.rampPerSecond;
  for (let i = 0; i < config.viewers; i++) {
    // Measures every outage: from losing the open connection to having one again.
    let wasOpen = false;
    let downSince: number | null = null;
    const viewer: LiveCanvas = new LiveCanvas({
      baseUrl: config.url,
      snapshotUrl: config.snapshotUrl,
      transport: config.transport,
      ...config.client,
      onApplied: (ms) => {
        if (measuring) latency.record(ms);
        if (target !== Infinity) fresh.add(viewer);
      },
      onChange: () => {
        const open = viewer.state === 'open';
        if (wasOpen && !open) downSince = performance.now();
        if (open && downSince !== null) {
          if (measuring) outages.record(performance.now() - downSince);
          downSince = null;
        }
        wasOpen = open;
      },
    });
    viewers.push(viewer);
    viewer.start().catch(() => failed++);
    await sleep(pauseMs);
  }
}

void ramp();
