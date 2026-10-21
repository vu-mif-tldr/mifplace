import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { TRANSPORTS } from '../shared/protocol.ts';
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
};

const log = (line: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
const report = await runLoad(options, log);
console.log(`\n${summarize(report)}`);

const stamp = report.startedAt.replace(/[:.]/g, '-').slice(0, 19);
const file = path.join(
  values.out,
  `${stamp}-${transport}-${options.viewers}v-${options.rate}r.json`
);
await mkdir(values.out, { recursive: true });
await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
console.log(`report       ${file}`);
// Stopped clients may still hold timers for a moment; the run is over.
process.exit(0);

function summarize(r: LoadReport): string {
  const o = r.options;
  const ms = (h: { p50: number; p95: number; p99: number; max: number }) =>
    `p50 ${h.p50} ms  p95 ${h.p95} ms  p99 ${h.p99} ms  max ${h.max} ms`;
  const c = r.correctness;
  const s = r.server;
  const yes = (ok: boolean) => (ok ? 'yes' : 'NO');
  return [
    `transport    ${o.transport} · ${o.viewers} viewers · ${o.rate} px/s · ` +
      `${o.durationS} s after ${o.warmupS} s warm-up · ${r.generator.threads} worker thread(s)`,
    `connect      ${r.connect.open}/${r.connect.viewers} open in ${r.connect.seconds} s, ` +
      `${r.connect.failed} failed`,
    `delivery     ${ms(r.delivery)}  (${r.delivery.count} samples)`,
    `correctness  gaps ${c.gaps}  duplicates ${c.duplicates}  resyncs ${c.resyncs}  ` +
      `reconnects ${c.reconnects}  behind at end ${c.behind}  open at end ${c.openAtEnd}`,
    `placements   ${r.placements.sent} sent (${r.placements.perSecond}/s), ` +
      `${r.placements.failed} failed, round trip ${ms(r.placements.rttMs)}`,
    `server       cpu avg ${s.cpuPercent.avg}% max ${s.cpuPercent.max}%  ` +
      `loop p99 worst second ${s.eventLoopWorstSecondP99Ms} ms  rss max ${s.rssMbMax} MB  ` +
      `heap max ${s.heapUsedMbMax} MB`,
    `server/s     ${s.perSecond.messages} messages  ${s.perSecond.batches} batches  ` +
      `${s.perSecond.placeRequests} POST /api/place  ${s.perSecond.lp} long polls  ` +
      `${s.perSecond.poll} short polls  ·  slow clients dropped ${s.slowClientsDropped}`,
    `load tool    cpu avg ${r.generator.cpuPercent.avg}% max ${r.generator.cpuPercent.max}%  ` +
      `loop p99/max: main ${r.generator.mainEventLoopMs.p99}/${r.generator.mainEventLoopMs.max} ms, ` +
      `viewers (worst thread) ${r.generator.viewerEventLoopMs.p99}/${r.generator.viewerEventLoopMs.max} ms`,
    `T1           ${r.verdict.t1.toUpperCase()}: p95 ${r.verdict.deliveryP95Ms} ms ` +
      `(≤ 1000: ${yes(r.verdict.withinTarget)}, ≤ 5000: ${yes(r.verdict.withinHardLimit)}), ` +
      `no lost events: ${yes(r.verdict.noLostEvents)}, all connected: ${yes(r.verdict.allConnected)}`,
    ...r.warnings.map((warning) => `WARNING      ${warning}`),
  ].join('\n');
}
