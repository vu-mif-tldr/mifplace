import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { positiveInt } from './env-number.js';

// Requests per client IP, one limit for every endpoint, each counted on its own (see
// .env.example and docs/api.md). GET /health and the WebSocket /api/ws have none: the liveness
// check must always answer, and the live connections have WS_MAX_CONNECTIONS.
export type RateLimits = {
  // GET /api/palette
  palettePerMinute: number;
  // GET /api/canvas/size
  canvasSizePerMinute: number;
  // GET /api/canvas: the costliest read, so the strictest of the reads
  canvasPerMinute: number;
  // POST /api/pixels: protects the event log
  pixelsPerMinute: number;
  // POST /api/waitlist. Campus Wi-Fi and dorms share addresses, so it is generous: the email
  // limits of the waitlist are what protects the mail quota.
  waitlistSignupsPerHour: number;
  // POST /api/waitlist/confirm
  waitlistConfirmPerMinute: number;
  // POST /api/waitlist/unsubscribe
  waitlistUnsubscribePerMinute: number;
  // Everything else: the page itself, its scripts, styles and fonts, and the 404 page
  otherPerMinute: number;
};

export const DEFAULT_RATE_LIMITS: RateLimits = {
  palettePerMinute: 120,
  canvasSizePerMinute: 120,
  canvasPerMinute: 20,
  pixelsPerMinute: 10,
  waitlistSignupsPerHour: 30,
  waitlistConfirmPerMinute: 120,
  waitlistUnsubscribePerMinute: 120,
  otherPerMinute: 120,
};

// The limits from the environment, the defaults for what is not set
export function rateLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimits {
  const d = DEFAULT_RATE_LIMITS;
  return {
    palettePerMinute: positiveInt(env, 'RATE_LIMIT_PALETTE_PER_MINUTE', d.palettePerMinute),
    canvasSizePerMinute: positiveInt(
      env,
      'RATE_LIMIT_CANVAS_SIZE_PER_MINUTE',
      d.canvasSizePerMinute
    ),
    canvasPerMinute: positiveInt(env, 'RATE_LIMIT_CANVAS_PER_MINUTE', d.canvasPerMinute),
    pixelsPerMinute: positiveInt(env, 'RATE_LIMIT_PIXELS_PER_MINUTE', d.pixelsPerMinute),
    waitlistSignupsPerHour: positiveInt(
      env,
      'RATE_LIMIT_WAITLIST_SIGNUP_PER_HOUR',
      d.waitlistSignupsPerHour
    ),
    waitlistConfirmPerMinute: positiveInt(
      env,
      'RATE_LIMIT_WAITLIST_CONFIRM_PER_MINUTE',
      d.waitlistConfirmPerMinute
    ),
    waitlistUnsubscribePerMinute: positiveInt(
      env,
      'RATE_LIMIT_WAITLIST_UNSUBSCRIBE_PER_MINUTE',
      d.waitlistUnsubscribePerMinute
    ),
    otherPerMinute: positiveInt(env, 'RATE_LIMIT_OTHER_PER_MINUTE', d.otherPerMinute),
  };
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// A limiter for one endpoint: `limit` requests per IP in a minute (or an hour), then 429 with
// the usual error body
export function limiter(
  limit: number,
  error = 'Too many requests, please try again later.',
  windowMs = MINUTE
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error },
  });
}

export const perHour = (limit: number, error?: string) => limiter(limit, error, HOUR);
