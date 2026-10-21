import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { LiveCanvas } from '../src/client/live-canvas.ts';
import { startApp, type App, type AppOptions } from '../src/server/app.ts';
import { CANVAS_WIDTH, TRANSPORTS } from '../src/shared/protocol.ts';

// A real server and the real client code, with timings shortened from seconds to milliseconds.
const SERVER: Partial<AppOptions> = {
  port: 0,
  batchMs: 20,
  heartbeatMs: 200,
  longPollTimeoutMs: 500,
  sseRetryMinMs: 50,
  sseRetryMaxMs: 100,
};
const CLIENT = {
  silenceTimeoutMs: 1_000,
  pollIntervalMs: 50,
  longPollTimeoutMs: 2_000,
  reconnectMinMs: 20,
  reconnectMaxMs: 200,
};

async function waitFor(what: string, condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

for (const transport of TRANSPORTS) {
  describe(`transport: ${transport}`, () => {
    let app: App;
    const clients: LiveCanvas[] = [];

    async function connect(): Promise<LiveCanvas> {
      const client = new LiveCanvas({ baseUrl: app.url, transport, ...CLIENT });
      clients.push(client);
      await client.start();
      await waitFor('the client is connected', () => client.state === 'open');
      return client;
    }

    before(async () => {
      app = await startApp(SERVER);
    });

    after(async () => {
      for (const client of clients) client.stop();
      await app.close();
    });

    it('two clients exchange one pixel', async () => {
      const [a, b] = [await connect(), await connect()];
      const result = await a.place(3, 4, 5);
      assert.ok(result.ok, JSON.stringify(result));

      await waitFor('B has the pixel', () => b.lastEventId >= result.id);
      assert.equal(b.cells[4 * CANVAS_WIDTH + 3], 5);
      await waitFor('A has its own pixel back', () => a.lastEventId >= result.id);
    });

    it('catches up after a lost connection, without gaps', async () => {
      const [a, b] = [await connect(), await connect()];
      b.drop();
      for (let x = 0; x < 5; x++) assert.ok((await a.place(x, 10, 2)).ok);

      await waitFor('B caught up', () => b.lastEventId === app.log.lastId);
      for (let x = 0; x < 5; x++) assert.equal(b.cells[10 * CANVAS_WIDTH + x], 2);
      assert.equal(b.stats.gaps, 0);
    });

    it('reloads the snapshot after a restart that lost the log', async () => {
      const a = await connect();
      assert.ok((await a.place(1, 1, 1)).ok);
      await waitFor('A has the pixel', () => a.lastEventId === app.log.lastId);
      const resyncsBefore = a.stats.resyncs;

      const port = Number(new URL(app.url).port);
      await app.close();
      app = await startApp({ ...SERVER, port });

      await waitFor('A reloaded the snapshot', () => a.stats.resyncs > resyncsBefore);
      await waitFor('A is connected again', () => a.state === 'open');
      const result = await a.place(2, 2, 3);
      assert.ok(result.ok, JSON.stringify(result));
      assert.equal(result.id, 1);
      await waitFor('A has the new pixel', () => a.lastEventId === 1);
      assert.equal(a.cells[2 * CANVAS_WIDTH + 2], 3);
      assert.equal(a.stats.gaps, 0);
    });
  });
}
