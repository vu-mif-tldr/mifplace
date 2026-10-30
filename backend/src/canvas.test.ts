import { afterAll, beforeAll, test } from 'vitest';
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { CanvasStateSchema, type CanvasState } from '@mifplace/shared';
import { createApp } from './app.js';

// The example of docs/api.md for a 3 x 2 canvas
const SNAPSHOT: CanvasState = {
  pixels: [5, 12, -1, -2, 5, -3],
  eventId: 102,
  timestamp: 1760000000000,
};

// getCanvasState throws when failing is true
let failing = false;

const app = createApp({
  canvasSize: { width: 3, height: 2 },
  palette: [{ id: 0, color: '#000000' }],
  checkHealth: () => {},
  getCanvasState: () => {
    if (failing) throw new Error('canvas is broken');
    return SNAPSHOT;
  },
  appendEvent: () => 1,
});

let testServer: Server;
let baseUrl: string;

// Port 0: the OS picks a free port, so this file can run in parallel with the other tests.
beforeAll(async () => {
  testServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => testServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(testServer.address() as AddressInfo).port}`;
});

afterAll(() => {
  return new Promise<void>((resolve) => testServer.close(() => resolve()));
});

test('GET /api/canvas - returns the snapshot with its checkpoint', async () => {
  failing = false;
  const response = await fetch(`${baseUrl}/api/canvas`);

  assert.strictEqual(response.status, 200);
  const body: unknown = await response.json();
  assert.deepStrictEqual(body, SNAPSHOT);
  // The frontend checks the response with this schema
  assert.ok(CanvasStateSchema.safeParse(body).success);
});

test('GET /api/canvas - a failure returns 500 without a snapshot', async () => {
  failing = true;
  const response = await fetch(`${baseUrl}/api/canvas`);

  assert.strictEqual(response.status, 500);
  assert.deepStrictEqual(await response.json(), {
    success: false,
    error: 'Internal server error',
  });
});
