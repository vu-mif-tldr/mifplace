import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import { createApp, listen, type AppConfig } from './app.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
});

async function health(config: Partial<AppConfig>) {
  const app = createApp({
    canvasSize: { width: 10, height: 10 },
    palette: [{ id: 0, color: '#000000' }],
    checkDbHealth: () => {},
    getCanvasState: () => ({ pixels: [], eventId: 0, timestamp: 0 }),
    appendEvent: () => 1,
    ...config,
  });
  const server = await listen(http.createServer(app), 0, '127.0.0.1');
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('GET /health', () => {
  it('shows the commit of the build', async () => {
    expect((await health({ commit: 'abc1234' })).body.commit).toBe('abc1234');
  });

  it('shows "dev" without a commit', async () => {
    expect((await health({})).body.commit).toBe('dev');
  });

  it('shows the commit while the database is down', async () => {
    const down = await health({
      commit: 'abc1234',
      checkDbHealth: () => {
        throw new Error('no database');
      },
    });
    expect(down.status).toBe(503);
    expect(down.body).toMatchObject({ status: 'down', commit: 'abc1234' });
  });
});
