import { afterEach, expect, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, listen } from './app.js';

const app = createApp({
  canvasSize: { width: 10, height: 10 },
  palette: [{ id: 0, color: '#000000' }],
  checkHealth: () => {},
  getCanvasState: () => ({ pixels: [] }),
  appendEvent: () => 1,
});

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve())))
  );
});

// Port 0: the OS picks a free port, so the test does not clash with a running backend
test('listen - resolves with a server that answers on a free port', async () => {
  const server = await listen(app, 0, '127.0.0.1');
  servers.push(server);
  const { port } = server.address() as AddressInfo;

  const response = await fetch(`http://127.0.0.1:${port}/api/canvas/size`);
  expect(await response.json()).toEqual({ width: 10, height: 10 });
});

test('listen - rejects with EADDRINUSE when the port is taken', async () => {
  const first = await listen(app, 0, '127.0.0.1');
  servers.push(first);
  const { port } = first.address() as AddressInfo;

  await expect(listen(app, port, '127.0.0.1')).rejects.toMatchObject({ code: 'EADDRINUSE' });
});
