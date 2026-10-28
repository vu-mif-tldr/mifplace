import { afterAll, beforeAll, test } from 'vitest';
import assert from 'node:assert';
import { createApp } from './app.js';
import { Server } from 'node:http';

const TEST_PORT = 3001;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
let testServer: Server;

const app = createApp({
  canvasSize: { width: 100, height: 100 },
  // Ids with gaps, as allowed by docs/api.md: the check must use the ids, not the count.
  palette: [
    { id: 0, color: '#000000' },
    { id: 5, color: '#FFFFFF' },
    { id: 12, color: '#FF0000' },
  ],
  checkHealth: () => {},
  getCanvasState: () => ({ pixels: [] }),
  appendEvent: () => 42,
});

beforeAll(async () => {
  testServer = app.listen(TEST_PORT, '127.0.0.1', () => {
    console.log(`Test server running at ${BASE_URL}`);
  });
});

afterAll(() => {
  return new Promise<void>((resolve) => {
    testServer.close(() => {
      console.log('Test server closed');
      resolve();
    });
  });
});

interface PixelResponse {
  success: boolean;
  eventId?: number;
  error?: string;
}

test('POST /api/pixels - valid input returns 201', async () => {
  const response = await fetch(`${BASE_URL}/api/pixels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: 10, y: 20, colorIndex: 0 }),
  });

  assert.strictEqual(response.status, 201);
  const data = (await response.json()) as PixelResponse;
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.eventId, 42);
});

test('POST /api/pixels - invalid x returns 400', async () => {
  const response = await fetch(`${BASE_URL}/api/pixels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: -1, y: 20, colorIndex: 0 }),
  });

  assert.strictEqual(response.status, 400);
});

test('POST /api/pixels - invalid y returns 400', async () => {
  const response = await fetch(`${BASE_URL}/api/pixels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: 10, y: -1, colorIndex: 0 }),
  });

  assert.strictEqual(response.status, 400);
});

test('POST /api/pixels - palette id above the palette size returns 201', async () => {
  const response = await fetch(`${BASE_URL}/api/pixels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: 10, y: 20, colorIndex: 12 }),
  });

  assert.strictEqual(response.status, 201);
});

const INVALID_COLORS: [string, unknown][] = [
  ['missing', undefined],
  ['fractional', 1.5],
  ['negative', -1],
  ['string', '0'],
  ['bool', true],
  ['object', {}],
  ['null', null],
  ['too large', 13],
  ['far too large', 999],
  ['unknown id in a gap', 3],
];

for (const [name, colorIndex] of INVALID_COLORS) {
  test(`POST /api/pixels - ${name} colorIndex returns 400`, async () => {
    const response = await fetch(`${BASE_URL}/api/pixels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // JSON.stringify drops a key whose value is undefined, so 'missing' sends no colorIndex
      body: JSON.stringify({ x: 10, y: 20, colorIndex }),
    });

    assert.strictEqual(response.status, 400);
    const data = (await response.json()) as PixelResponse;
    assert.match(data.error || '', /Color not in palette/);
  });
}
