import { afterAll, beforeAll, test } from 'vitest';
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import type { PaletteColor } from '@mifplace/shared';
import { createApp } from './app.js';

const PALETTE: PaletteColor[] = [
  { id: 0, color: '#000000' },
  { id: 5, color: '#FFFFFF' },
];

let testServer: Server;
let baseUrl: string;

const app = createApp({
  canvasSize: { width: 100, height: 100 },
  palette: PALETTE,
  checkHealth: () => {},
  getCanvasState: () => ({ pixels: [] }),
  appendEvent: () => 42,
});

// Port 0: the OS picks a free port, so this file can run in parallel with pixels.test.ts.
beforeAll(async () => {
  testServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => testServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(testServer.address() as AddressInfo).port}`;
});

afterAll(() => {
  return new Promise<void>((resolve) => testServer.close(() => resolve()));
});

test('GET /api/palette - returns the palette as JSON', async () => {
  const response = await fetch(`${baseUrl}/api/palette`);

  assert.strictEqual(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.deepStrictEqual(await response.json(), PALETTE);
});

test('GET /api/canvas/size - returns the canvas size as JSON', async () => {
  const response = await fetch(`${baseUrl}/api/canvas/size`);

  assert.strictEqual(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.deepStrictEqual(await response.json(), { width: 100, height: 100 });
});
