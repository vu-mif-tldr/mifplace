import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import { createApp, listen } from './app.js';
import { DEFAULT_RATE_LIMITS, rateLimitsFromEnv, type RateLimits } from './rate-limits.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
});

async function start(rateLimits: Partial<RateLimits>): Promise<string> {
  const app = createApp({
    canvasSize: { width: 10, height: 10 },
    palette: [{ id: 0, color: '#000000' }],
    checkDbHealth: () => {},
    getCanvasState: () => ({ pixels: [], eventId: 0, timestamp: 0 }),
    appendEvent: () => 1,
    rateLimits,
  });
  const server = await listen(http.createServer(app), 0, '127.0.0.1');
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

const pixel = (baseUrl: string) =>
  fetch(`${baseUrl}/api/pixels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pos: 0, colorIndex: 0 }),
  });

// `allowed` answers with `ok`, the next one is 429 with `error`
async function expectLimit(
  request: () => Promise<Response>,
  allowed: number,
  ok: number,
  error: string
) {
  for (let i = 0; i < allowed; i += 1) expect((await request()).status).toBe(ok);
  const limited = await request();
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({ success: false, error });
}

const GENERAL = 'Too many requests, please try again later.';

describe('rate limits', () => {
  it('limits every endpoint with its own setting and its own count', async () => {
    const baseUrl = await start({
      palettePerMinute: 1,
      canvasSizePerMinute: 2,
      canvasPerMinute: 3,
      pixelsPerMinute: 4,
      otherPerMinute: 5,
    });
    await expectLimit(() => fetch(`${baseUrl}/api/palette`), 1, 200, GENERAL);
    await expectLimit(() => fetch(`${baseUrl}/api/canvas/size`), 2, 200, GENERAL);
    await expectLimit(
      () => fetch(`${baseUrl}/api/canvas`),
      3,
      200,
      'Too many requests for /api/canvas, please try again later.'
    );
    await expectLimit(
      () => pixel(baseUrl),
      4,
      201,
      'Too many pixel submissions, please try again later.'
    );
    // The page, its files and the 404 page share the last limit
    await expectLimit(() => fetch(`${baseUrl}/no-such-file`), 5, 404, GENERAL);
  });

  it('never limits /health', async () => {
    const baseUrl = await start({ otherPerMinute: 1, palettePerMinute: 1 });
    for (let i = 0; i < 5; i += 1) {
      expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    }
  });
});

describe('rateLimitsFromEnv', () => {
  it('uses the defaults when nothing is set, an empty value counts as unset', () => {
    expect(rateLimitsFromEnv({})).toEqual(DEFAULT_RATE_LIMITS);
    expect(rateLimitsFromEnv({ RATE_LIMIT_PIXELS_PER_MINUTE: '' })).toEqual(DEFAULT_RATE_LIMITS);
  });

  it('reads every setting', () => {
    expect(
      rateLimitsFromEnv({
        RATE_LIMIT_PALETTE_PER_MINUTE: '1',
        RATE_LIMIT_CANVAS_SIZE_PER_MINUTE: '2',
        RATE_LIMIT_CANVAS_PER_MINUTE: '3',
        RATE_LIMIT_PIXELS_PER_MINUTE: '4',
        RATE_LIMIT_WAITLIST_SIGNUP_PER_HOUR: '5',
        RATE_LIMIT_WAITLIST_CONFIRM_PER_MINUTE: '6',
        RATE_LIMIT_WAITLIST_UNSUBSCRIBE_PER_MINUTE: '7',
        RATE_LIMIT_OTHER_PER_MINUTE: '8',
        RATE_LIMIT_AUTH_REGISTER_PER_HOUR: '9',
        RATE_LIMIT_AUTH_LOGIN_PER_MINUTE: '10',
        RATE_LIMIT_AUTH_PASSWORD_PER_HOUR: '11',
        RATE_LIMIT_AUTH_PER_MINUTE: '12',
      })
    ).toEqual({
      palettePerMinute: 1,
      canvasSizePerMinute: 2,
      canvasPerMinute: 3,
      pixelsPerMinute: 4,
      waitlistSignupsPerHour: 5,
      waitlistConfirmPerMinute: 6,
      waitlistUnsubscribePerMinute: 7,
      otherPerMinute: 8,
      authRegisterPerHour: 9,
      authLoginPerMinute: 10,
      authPasswordPerHour: 11,
      authPerMinute: 12,
    });
  });

  it.each(['0', '-1', '1.5', '1e3', ' 1', 'many'])('stops at start on %j', (value) => {
    expect(() => rateLimitsFromEnv({ RATE_LIMIT_PIXELS_PER_MINUTE: value })).toThrow(
      `Invalid RATE_LIMIT_PIXELS_PER_MINUTE: ${value}`
    );
  });
});
