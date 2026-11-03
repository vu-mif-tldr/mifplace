import { afterEach, expect, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, listen } from './app.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
});

test('rate limits general requests, canvas reads, and pixel writes independently', async () => {
  const app = createApp({
    canvasSize: { width: 10, height: 10 },
    palette: [{ id: 0, color: '#000000' }],
    checkHealth: () => {},
    getCanvasState: () => ({ pixels: [], eventId: 0, timestamp: 0 }),
    appendEvent: () => 1,
    rateLimitPerMinute: 3,
    canvasRateLimitPerMinute: 2,
    pixelRateLimitPerMinute: 2,
  });
  const server = await listen(app, 0, '127.0.0.1');
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  for (let i = 0; i < 3; i += 1) {
    expect((await fetch(`${baseUrl}/api/palette`)).status).toBe(200);
  }
  const generalLimitResponse = await fetch(`${baseUrl}/api/palette`);
  expect(generalLimitResponse.status).toBe(429);
  expect(await generalLimitResponse.json()).toEqual({
    success: false,
    error: 'Too many requests, please try again later.',
  });

  for (let i = 0; i < 2; i += 1) {
    expect((await fetch(`${baseUrl}/api/canvas`)).status).toBe(200);
  }
  const canvasLimitResponse = await fetch(`${baseUrl}/api/canvas`);
  expect(canvasLimitResponse.status).toBe(429);
  expect(await canvasLimitResponse.json()).toEqual({
    success: false,
    error: 'Too many requests for /api/canvas, please try again later.',
  });

  const pixelRequest = () =>
    fetch(`${baseUrl}/api/pixels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pos: 0, colorIndex: 0 }),
    });

  for (let i = 0; i < 2; i += 1) {
    expect((await pixelRequest()).status).toBe(201);
  }
  const pixelLimitResponse = await pixelRequest();
  expect(pixelLimitResponse.status).toBe(429);
  expect(await pixelLimitResponse.json()).toEqual({
    success: false,
    error: 'Too many pixel submissions, please try again later.',
  });

  for (let i = 0; i < 5; i += 1) {
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
  }
});
