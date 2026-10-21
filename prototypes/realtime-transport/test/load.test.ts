import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Histogram } from '../src/load/histogram.ts';
import { DEFAULT_LOAD_OPTIONS, runLoad, type LoadOptions } from '../src/load/run.ts';
import { startApp, type App, type AppOptions } from '../src/server/app.ts';
import { TRANSPORTS } from '../src/shared/protocol.ts';

describe('Histogram', () => {
  it('gives nearest-rank percentiles with 1 ms resolution', () => {
    const histogram = new Histogram();
    for (let ms = 1; ms <= 100; ms++) histogram.record(ms);
    assert.deepEqual(histogram.summary(), {
      count: 100,
      mean: 51,
      p50: 50,
      p95: 95,
      p99: 99,
      max: 100,
    });
  });

  it('adds up histograms from several threads', () => {
    const [a, b] = [new Histogram(), new Histogram()];
    a.record(10);
    b.record(30);
    b.record(-5);
    a.merge(b.data());
    assert.equal(a.count, 3);
    assert.equal(a.negative, 1);
    assert.equal(a.percentile(100), 30);
  });
});

// Miniature runs of the real load tool: a few viewers in two worker threads, seconds not minutes.
const SERVER: Partial<AppOptions> = {
  port: 0,
  batchMs: 20,
  heartbeatMs: 200,
  longPollTimeoutMs: 500,
  sseRetryMinMs: 50,
  sseRetryMaxMs: 100,
};
const RUN: Partial<LoadOptions> = {
  viewers: 6,
  workers: 2,
  rate: 20,
  rampPerSecond: 200,
  warmupS: 0.3,
  durationS: 1,
  drainMs: 3_000,
  client: { pollIntervalMs: 50, reconnectMinMs: 20, reconnectMaxMs: 200 },
};

describe('runLoad', () => {
  let app: App;

  before(async () => {
    app = await startApp(SERVER);
  });

  after(async () => {
    await app.close();
  });

  const run = (options: Partial<LoadOptions>) =>
    runLoad({ ...DEFAULT_LOAD_OPTIONS, ...RUN, url: app.url, ...options });

  for (const transport of TRANSPORTS) {
    it(`T1, ${transport}: measures without losing events`, async () => {
      const report = await run({ transport });
      assert.equal(report.scenario, 't1');
      assert.equal(report.connect.open, 6);
      assert.ok(report.placements.sent > 0);
      assert.ok(report.viewers.delivery.count > 0);
      assert.equal(report.viewers.behind, 0);
      assert.equal(report.viewers.stats.gaps, 0);
      assert.equal(report.server.samples.length, 1);
      assert.ok(report.verdict.checks['no lost events'] && report.verdict.checks['all connected']);
    });

    it(`T3, ${transport}: catches up after the server drops connections`, async () => {
      const report = await run({ transport, dropPerSecond: 3, durationS: 2 });
      assert.equal(report.viewers.stats.gaps, 0);
      assert.equal(report.viewers.behind, 0);
      if (transport === 'poll') {
        // Nothing to drop: short polling holds no connection between requests.
        assert.equal(report.verdict.result, 'not applicable');
        return;
      }
      assert.ok((report.drops?.applied ?? 0) > 0);
      assert.ok(report.viewers.outages.count > 0);
      assert.equal(report.viewers.stats.resyncs, 0);
      assert.equal(report.verdict.result, 'pass', JSON.stringify(report.verdict));
    });

    it(`T5, ${transport}: slow viewers behind a throttling proxy get events too`, async () => {
      const report = await run({
        transport,
        slowViewers: 2,
        // Fast enough for a test to finish; the real runs use about 1 KB/s.
        slowReadBytesPerSecond: 50_000,
      });
      assert.equal(report.slow?.viewers, 2);
      assert.ok((report.slow?.delivery.count ?? 0) > 0);
      assert.equal(report.slow?.stats.gaps, 0);
      assert.ok(report.verdict.checks['others: no lost events']);
      assert.ok(['pass', 'inconclusive'].includes(report.verdict.result));
    });
  }
});

describe('runLoad, T4', () => {
  // Every run restarts the server, so each gets its own.
  for (const persistent of [true, false]) {
    for (const transport of persistent ? TRANSPORTS : (['ws'] as const)) {
      const kind = persistent ? 'a log file' : 'an in-memory log';
      it(`${transport} with ${kind}: everyone catches up after a restart`, async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'realtime-t4-'));
        const logFile = persistent ? path.join(dir, 'events.jsonl') : '';
        let app = await startApp({ ...SERVER, logFile });
        const port = Number(new URL(app.url).port);
        try {
          const report = await runLoad(
            {
              ...DEFAULT_LOAD_OPTIONS,
              ...RUN,
              url: app.url,
              transport,
              durationS: 3,
              restartAtS: 1,
            },
            () => {},
            {
              async restartServer() {
                await app.close();
                app = await startApp({ ...SERVER, logFile, port });
              },
            }
          );
          assert.equal(report.scenario, 't4');
          assert.equal(report.server.restarts, 1);
          assert.notEqual(report.restart?.allCaughtUpS, null);
          assert.equal(report.viewers.stats.gaps, 0);
          assert.equal(report.viewers.behind, 0);
          // With the log kept, viewers continue from their last event; without it, they reload.
          if (persistent) assert.equal(report.viewers.stats.resyncs, 0);
          else assert.ok(report.viewers.stats.resyncs >= 6);
          assert.equal(report.verdict.result, 'pass', JSON.stringify(report.verdict));
        } finally {
          await app.close();
        }
      });
    }
  }
});
