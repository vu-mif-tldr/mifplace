import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Histogram } from '../src/load/histogram.ts';
import { DEFAULT_LOAD_OPTIONS, runLoad } from '../src/load/run.ts';
import { startApp, type App } from '../src/server/app.ts';
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

// A miniature run of the real load tool: a few viewers in two worker threads, seconds not minutes.
describe('runLoad', () => {
  let app: App;

  before(async () => {
    app = await startApp({ port: 0, batchMs: 20, heartbeatMs: 200, longPollTimeoutMs: 500 });
  });

  after(async () => {
    await app.close();
  });

  for (const transport of TRANSPORTS) {
    it(`measures ${transport} without losing events`, async () => {
      const report = await runLoad({
        ...DEFAULT_LOAD_OPTIONS,
        url: app.url,
        transport,
        viewers: 6,
        workers: 2,
        rate: 20,
        rampPerSecond: 200,
        warmupS: 0.3,
        durationS: 1,
        drainMs: 3_000,
        client: { pollIntervalMs: 50, reconnectMinMs: 20, reconnectMaxMs: 200 },
      });
      assert.equal(report.connect.open, 6);
      assert.ok(report.placements.sent > 0);
      assert.ok(report.delivery.count > 0);
      assert.equal(report.correctness.behind, 0);
      assert.equal(report.correctness.gaps, 0);
      assert.equal(report.server.samples.length, 1);
      assert.ok(report.verdict.noLostEvents && report.verdict.allConnected);
    });
  }
});
