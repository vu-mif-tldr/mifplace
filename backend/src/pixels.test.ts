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

// Not an integer: the request schema rejects it and names the field
const MALFORMED_COLORS: [string, unknown][] = [
  ['missing', undefined],
  ['fractional', 1.5],
  ['string', '0'],
  ['bool', true],
  ['object', {}],
  ['null', null],
];

for (const [name, colorIndex] of MALFORMED_COLORS) {
  test(`POST /api/pixels - ${name} colorIndex returns 400`, async () => {
    const response = await fetch(`${BASE_URL}/api/pixels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // JSON.stringify drops a key whose value is undefined, so 'missing' sends no colorIndex
      body: JSON.stringify({ x: 10, y: 20, colorIndex }),
    });

    assert.strictEqual(response.status, 400);
    const data = (await response.json()) as PixelResponse;
    assert.match(data.error || '', /^colorIndex: /);
  });
}

// An integer that is not a palette id: the server's own check
const UNKNOWN_COLORS: [string, number][] = [
  ['negative', -1],
  ['too large', 13],
  ['far too large', 999],
  ['unknown id in a gap', 3],
];

for (const [name, colorIndex] of UNKNOWN_COLORS) {
  test(`POST /api/pixels - ${name} colorIndex returns 400`, async () => {
    const response = await fetch(`${BASE_URL}/api/pixels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 10, y: 20, colorIndex }),
    });

    assert.strictEqual(response.status, 400);
    const data = (await response.json()) as PixelResponse;
    assert.match(data.error || '', /Color not in palette/);
  });
}

test('POST /api/pixels - a cell outside the canvas names the limit', async () => {
  const response = await fetch(`${BASE_URL}/api/pixels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: 100, y: 20, colorIndex: 0 }),
  });

  assert.strictEqual(response.status, 400);
  const data = (await response.json()) as PixelResponse;
  assert.strictEqual(data.error, 'x: x must be less than canvas width (100)');
});

test('POST /api/pixels - a string coordinate returns 400', async () => {
  const response = await fetch(`${BASE_URL}/api/pixels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: '10', y: 20, colorIndex: 0 }),
  });

  assert.strictEqual(response.status, 400);
  const data = (await response.json()) as PixelResponse;
  assert.match(data.error || '', /^x: /);
});

test('POST /api/pixels - a request without a JSON body returns 400', async () => {
  const response = await fetch(`${BASE_URL}/api/pixels`, { method: 'POST' });

  assert.strictEqual(response.status, 400);
  const data = (await response.json()) as PixelResponse;
  assert.strictEqual(data.success, false);
});
