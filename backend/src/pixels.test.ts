import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { app } from './server.js';
import { Server } from 'node:http';

const TEST_PORT = 3001;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
let testServer: Server;

before(async () => {
  testServer = app.listen(TEST_PORT, '127.0.0.1', () => {
    console.log(`Test server running at ${BASE_URL}`);
  });
});

after(() => {
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

test('POST /api/pixels - invalid color returns 400', async () => {
  const response = await fetch(`${BASE_URL}/api/pixels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: 10, y: 20, colorIndex: -1 }),
  });

  assert.strictEqual(response.status, 400);
});

test('POST /api/pixels - color not in palette returns 400', async () => {
  const response = await fetch(`${BASE_URL}/api/pixels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: 10, y: 20, colorIndex: 999 }),
  });

  assert.strictEqual(response.status, 400);
  const data = (await response.json()) as PixelResponse;
  assert.match(data.error || '', /Color not in palette/);
});
