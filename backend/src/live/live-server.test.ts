import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../app.js';
import { CanvasStore } from '../canvas-state.js';
import { startLiveServer, type LiveServer, type LiveServerOptions } from './live-server.js';

// The app and the live server wired as server.ts does it, with the canvas in memory instead of
// the database: POST /api/pixels stores the pixel, applies it and publishes it in one step.

const servers: http.Server[] = [];
const liveServers: LiveServer[] = [];
const clients: WebSocket[] = [];

async function start(options: Partial<LiveServerOptions> = {}) {
  const canvas = new CanvasStore({ width: 10, height: 10 });
  let nextId = 1;
  let now = 1_760_000_000_000;

  const app = createApp({
    canvasSize: { width: 10, height: 10 },
    palette: [
      { id: 5, color: '#FFFFFF' },
      { id: 12, color: '#FF0000' },
    ],
    checkDbHealth: () => {},
    getCanvasState: () => canvas.snapshot(),
    appendEvent(event) {
      const placed = {
        eventId: nextId++,
        pos: event.position,
        colorId: event.color_id,
        timestamp: now++,
      };
      canvas.apply(placed);
      live.publish(placed);
      return placed.eventId;
    },
    getLiveStats: () => live.stats(),
    pixelRateLimitPerMinute: 1000,
  });

  const server = http.createServer(app);
  servers.push(server);
  const live = startLiveServer(server, () => canvas.checkpoint, {
    path: '/api/ws',
    maxConnections: 10,
    allowedOrigins: [],
    maxPayload: 1024,
    maxBufferedBytes: 1024 * 1024,
    batchMs: 20,
    ...options,
  });
  liveServers.push(live);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/api/ws`, live };
}

// Collects the text messages and the close code from the moment the socket is created: a reset
// and the close after it arrive right after the upgrade, before a listener added later would run.
function connect(
  url: string
): Promise<{ ws: WebSocket; messages: unknown[]; closed: Promise<number> }> {
  const ws = new WebSocket(url);
  clients.push(ws);
  const messages: unknown[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  const closed = new Promise<number>((resolve) => ws.once('close', resolve));
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, messages, closed }));
    ws.once('error', reject);
  });
}

async function place(base: string, pos: number, colorIndex: number) {
  const response = await fetch(`${base}/api/pixels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pos, colorIndex }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { eventId: number };
}

afterEach(async () => {
  for (const live of liveServers.splice(0)) live.close();
  for (const ws of clients.splice(0)) {
    ws.on('error', () => {});
    ws.terminate();
  }
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve())))
  );
});

describe('live server', () => {
  it('sends a stored pixel to every connected client, the sender included', async () => {
    const { http, ws } = await start();
    const a = await connect(ws);
    const b = await connect(ws);

    const { eventId } = await place(http, 4, 12);

    const expected = {
      type: 'pixels',
      pixels: [[eventId, 4, 12]],
      eventId,
      timestamp: 1_760_000_000_000,
    };
    await vi.waitFor(() => expect(a.messages).toEqual([expected]));
    await vi.waitFor(() => expect(b.messages).toEqual([expected]));
  });

  it('sends the pixels of one batch as one message', async () => {
    const { http, ws } = await start({ batchMs: 200 });
    const { messages } = await connect(ws);

    await place(http, 1, 5);
    await place(http, 2, 12);

    await vi.waitFor(
      () =>
        expect(messages).toEqual([
          {
            type: 'pixels',
            pixels: [
              [1, 1, 5],
              [2, 2, 12],
            ],
            eventId: 2,
            timestamp: 1_760_000_000_001,
          },
        ]),
      { timeout: 1000 }
    );
  });

  it('matches the format of docs/api.md: the snapshot checkpoint continues into the stream', async () => {
    const { http, ws } = await start();
    await place(http, 1, 5);
    const snapshot = (await (await fetch(`${http}/api/canvas`)).json()) as {
      eventId: number;
      timestamp: number;
    };
    expect(snapshot).toMatchObject({ eventId: 1, timestamp: 1_760_000_000_000 });

    // Resume from the snapshot once its event went out: nothing to catch up, the next pixel
    // comes as a batch
    await new Promise((resolve) => setTimeout(resolve, 60));
    const { messages } = await connect(
      `${ws}?afterEventId=${snapshot.eventId}&afterTimestamp=${snapshot.timestamp}`
    );
    await place(http, 2, 12);
    await vi.waitFor(() =>
      expect(messages).toEqual([
        { type: 'pixels', pixels: [[2, 2, 12]], eventId: 2, timestamp: 1_760_000_000_001 },
      ])
    );
  });

  it('may repeat stored but unsent events to a resuming client, which skips them', async () => {
    const { http, ws } = await start({ batchMs: 200 });
    await place(http, 1, 5);
    // Connects before the batch with event 1 went out: the batch is one string for everyone
    const { messages } = await connect(`${ws}?afterEventId=1&afterTimestamp=1760000000000`);
    await place(http, 2, 12);

    await vi.waitFor(
      () =>
        expect(messages).toEqual([
          {
            type: 'pixels',
            pixels: [
              [1, 1, 5],
              [2, 2, 12],
            ],
            eventId: 2,
            timestamp: 1_760_000_000_001,
          },
        ]),
      { timeout: 1000 }
    );
  });

  it('answers reset to a client with only one resume parameter and closes it', async () => {
    const { ws } = await start();
    const { closed, messages } = await connect(`${ws}?afterEventId=1`);
    expect(await closed).toBe(1000);
    expect(messages).toEqual([{ type: 'reset' }]);
  });

  it('answers reset to a checkpoint this log does not know, pending batch or not', async () => {
    const { http, ws } = await start({ batchMs: 200 });
    await place(http, 1, 5);

    // Ahead of the last event, and the last event with another time (a restored database)
    const ahead = await connect(`${ws}?afterEventId=7&afterTimestamp=1`);
    const mismatch = await connect(`${ws}?afterEventId=1&afterTimestamp=1`);
    expect(await ahead.closed).toBe(1000);
    expect(await mismatch.closed).toBe(1000);
    // The batch with event 1 went out after the resets, not to the closed connections
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(ahead.messages).toEqual([{ type: 'reset' }]);
    expect(mismatch.messages).toEqual([{ type: 'reset' }]);
  });

  it('sends nothing to a client without a checkpoint until a pixel is placed', async () => {
    const { http, ws } = await start();
    const { messages } = await connect(ws);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(messages).toEqual([]);

    await place(http, 3, 5);
    await vi.waitFor(() => expect(messages).toHaveLength(1));
  });

  it('closes a client that sends a message with 1003', async () => {
    const { ws, live } = await start();
    const { ws: client, closed } = await connect(ws);

    client.send('hello');

    expect(await closed).toBe(1003);
    await vi.waitFor(() => expect(live.stats().open).toBe(0));
  });

  it('reports the connections in GET /health', async () => {
    const { http, ws } = await start();
    await connect(ws);
    await connect(ws);

    const health = (await (await fetch(`${http}/health`)).json()) as { WS: unknown };
    expect(health.WS).toEqual({ open: 2, slowDropped: 0, terminated: 0 });
  });

  it('closes every client with 1001 on shutdown and sends no pending batch', async () => {
    const { http, ws, live } = await start({ batchMs: 500 });
    const { closed, messages } = await connect(ws);

    await place(http, 1, 5);
    live.close();

    expect(await closed).toBe(1001);
    expect(messages).toEqual([]);
  });
});
