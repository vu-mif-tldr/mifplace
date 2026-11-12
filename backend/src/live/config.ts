import { DEFAULT_CHECK_INTERVAL_MS, DEFAULT_IDLE_MS, DEFAULT_PONG_TIMEOUT_MS } from './liveness.js';
import type { LiveServerOptions } from './live-server.js';

// The live server settings from the environment (see .env.example), with the defaults of
// docs/api.md. A value that is set but not a positive integer stops the server at start,
// like an invalid PORT: a typo must not silently turn off the liveness check.
export function liveOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): LiveServerOptions {
  return {
    path: '/api/ws',
    // Clients send nothing, so a legitimate message is never longer than this
    maxPayload: 1024,
    batchMs: positiveInt(env, 'WS_BATCH_MS', 100),
    maxConnections: positiveInt(env, 'WS_MAX_CONNECTIONS', 2000),
    // A client more events behind than this reloads the snapshot instead of catching up
    maxBacklog: positiveInt(env, 'WS_MAX_BACKLOG', 10000),
    // A client that cannot keep up with this many unsent bytes is dropped (ADR-0003)
    maxBufferedBytes: positiveInt(env, 'WS_MAX_BUFFERED_BYTES', 256 * 1024),
    // The page's own host is always allowed; this is for other origins, comma-separated
    allowedOrigins: (env.WS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ''),
    liveness: {
      idleMs: positiveInt(env, 'WS_IDLE_PING_MS', DEFAULT_IDLE_MS),
      pongTimeoutMs: positiveInt(env, 'WS_PONG_TIMEOUT_MS', DEFAULT_PONG_TIMEOUT_MS),
      intervalMs: positiveInt(env, 'WS_LIVENESS_CHECK_MS', DEFAULT_CHECK_INTERVAL_MS),
    },
  };
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  // Digits only: "1e3", "1.5" and " 1" are mistakes, not settings
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return Number(raw);
}
