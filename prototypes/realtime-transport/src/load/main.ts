import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { TRANSPORTS } from '../shared/protocol.ts';
import type { HistogramSummary } from './histogram.ts';
import { DEFAULT_LOAD_OPTIONS, runLoad, type LoadOptions, type LoadReport } from './run.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    transport: { type: 'string' },
    viewers: { type: 'string' },
    rate: { type: 'string' },
    ramp: { type: 'string' },
    warmup: { type: 'string' },
    duration: { type: 'string' },
    workers: { type: 'string' },
    'drain-ms': { type: 'string' },
    'drop-per-second': { type: 'string' },
    'restart-at': { type: 'string' },
    slow: { type: 'string' },
    'slow-read-bps': { type: 'string' },
    out: { type: 'string', default: 'results' },
  },
});

const transport = TRANSPORTS.find((name) => name === values.transport);
if (transport === undefined) {
  throw new Error(`--transport must be one of ${TRANSPORTS.join(', ')}, got "${values.transport}"`);
}
const number = (flag: string | undefined, fallback: number) => {
  if (flag === undefined) return fallback;
  const value = Number(flag);
  if (!Number.isFinite(value) || value < 0) throw new Error(`not a number: "${flag}"`);
  return value;
};
const defaults = DEFAULT_LOAD_OPTIONS;
const options: LoadOptions = {
  ...defaults,
  url: values.url ?? defaults.url,
  transport,
  viewers: number(values.viewers, defaults.viewers),
  rate: number(values.rate, defaults.rate),
  rampPerSecond: number(values.ramp, defaults.rampPerSecond),
  warmupS: number(values.warmup, defaults.warmupS),
  durationS: number(values.duration, defaults.durationS),
  workers: number(values.workers, defaults.workers),
  drainMs: number(values['drain-ms'], defaults.drainMs),
  dropPerSecond: number(values['drop-per-second'], defaults.dropPerSecond),
  restartAtS: number(values['restart-at'], defaults.restartAtS),
  slowViewers: number(values.slow, defaults.slowViewers),
  slowReadBytesPerSecond: number(values['slow-read-bps'], defaults.slowReadBytesPerSecond),
};

const log = (line: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
const report = await runLoad(options, log);
console.log(`\n${summarize(report)}`);

const stamp = report.startedAt.replace(/[:.]/g, '-').slice(0, 19);
// T4 runs once with the event log in a file and once in memory: the name tells them apart.
const variant =
  report.scenario === 't4' ? (report.environment.server.persistentLog ? '-file' : '-memory') : '';
const name =
  `${stamp}-${report.scenario}${variant}-${transport}-` +
  `${options.viewers}v-${options.rate}r.json`;
await mkdir(values.out, { recursive: true });
await writeFile(path.join(values.out, name), `${JSON.stringify(report, null, 2)}\n`);
console.log(`report       ${path.join(values.out, name)}`);
// Stopped clients may still hold timers for a moment; the run is over.
process.exit(0);

function summarize(r: LoadReport): string {
  const o = r.options;
  const ms = (h: HistogramSummary) =>
    `p50 ${h.p50} ms  p95 ${h.p95} ms  p99 ${h.p99} ms  max ${h.max} ms`;
  const v = r.viewers;
  const s = r.server;
  const g = r.generator;
  const lines = [
    `scenario     ${r.scenario.toUpperCase()} · ${o.transport} · ${o.viewers} viewers · ` +
      `${o.rate} px/s · ${o.durationS} s after ${o.warmupS} s warm-up · ${g.threads} thread(s)`,
    `connect      ${r.connect.open}/${r.connect.viewers} open in ${r.connect.seconds} s, ` +
      `${r.connect.failed} failed`,
    `delivery     ${ms(v.delivery)}  (${v.delivery.count} samples)`,
    `correctness  gaps ${v.stats.gaps}  duplicates ${v.stats.duplicates}  ` +
      `resyncs ${v.stats.resyncs}  snapshot failures ${v.stats.snapshotFailures}  ` +
      `reconnects ${v.stats.reconnects}  behind at end ${v.behind}  open at end ${v.openAtEnd}`,
    `placements   ${r.placements.sent} sent (${r.placements.perSecond}/s), ` +
      `${r.placements.failed} failed, round trip ${ms(r.placements.rttMs)}`,
    `server       cpu avg ${s.cpuPercent.avg}% max ${s.cpuPercent.max}%  ` +
      `loop p99 worst second ${s.eventLoopWorstSecondP99Ms} ms  ` +
      `rss ${s.rssMb.atStart} -> max ${s.rssMb.max} MB  heap max ${s.heapUsedMbMax} MB`,
    `server/s     ${s.perSecond.messages} messages  ${s.perSecond.batches} batches  ` +
      `${s.perSecond.placeRequests} POST /api/place  ${s.perSecond.lp} long polls  ` +
      `${s.perSecond.poll} short polls`,
    `server total slow clients dropped ${s.totals.slowClientsDropped}  ` +
      `ping timeouts ${s.totals.pingTimeouts}  errors ${s.totals.errors}  ` +
      `restarts ${s.restarts}  missed samples ${s.missedSamples}`,
    `load tool    cpu avg ${g.cpuPercent.avg}% max ${g.cpuPercent.max}%  loop p99/max: ` +
      `main ${g.mainEventLoopMs.p99}/${g.mainEventLoopMs.max} ms, ` +
      `viewers (worst thread) ${g.viewerEventLoopMs.p99}/${g.viewerEventLoopMs.max} ms`,
  ];
  if (v.outages.count > 0) {
    lines.push(`outages      ${v.outages.count}: ${ms(v.outages)} without an open connection`);
  }
  if (r.drops !== undefined) {
    lines.push(`drops        ${r.drops.applied} applied of ${r.drops.requested} requested`);
  }
  if (r.restart !== undefined) {
    lines.push(
      `restart      server back after ${r.restart.downS ?? 'never'} s, every viewer caught up ` +
        `after ${r.restart.allCaughtUpS ?? 'never'} s (from the exit, target event ` +
        `${r.restart.targetId ?? '-'})`
    );
  }
  if (r.slow !== undefined) {
    lines.push(
      `slow         ${r.slow.viewers} viewers at ${r.slow.readBytesPerSecond} B/s: ` +
        `${ms(r.slow.delivery)}, gaps ${r.slow.stats.gaps}, resyncs ${r.slow.stats.resyncs}, ` +
        `reconnects ${r.slow.stats.reconnects}, behind at end ${r.slow.behind}`
    );
  }
  const checks = Object.entries(r.verdict.checks)
    .map(([name, ok]) => `${name}: ${ok ? 'yes' : 'NO'}`)
    .join(', ');
  lines.push(
    `verdict      ${r.verdict.scenario.toUpperCase()} ${r.verdict.result.toUpperCase()}: ${checks}`
  );
  lines.push(...r.warnings.map((warning) => `WARNING      ${warning}`));
  return lines.join('\n');
}
