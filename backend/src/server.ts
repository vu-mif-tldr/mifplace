import {
  MifDb,
  type NewEvent,
  getDbVersion,
  loadDotEnv,
  openDb,
  resolveDbPath,
} from '@mifplace/db';
import http from 'node:http';
import { createApp, listen } from './app.js';
import type { CanvasStore } from './canvas-state.js';
import { loadCanvas, placePixel } from './canvas-log.js';
import type { CanvasSize, PaletteColor } from '@mifplace/shared';
import { liveOptionsFromEnv } from './live/config.js';
import { startLiveServer } from './live/live-server.js';
import { mailerFromEnv } from './mailer.js';
import { CONFIRM_WITHIN_MS, type WaitlistOptions } from './waitlist.js';

// Settings come from the environment, then from .env in the repository root (see .env.example).
loadDotEnv();

const PORT: number = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
const hostname: string = process.env.HOST ?? '127.0.0.1';

// Express "trust proxy" (see .env.example): "true", a number of hops, or addresses/subnets
// such as "loopback" or "uniquelocal". Unset: the app is reached directly, no proxy is trusted.
function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

// Fails here, before the database is opened, if a WS_* setting is not a positive integer.
const liveOptions = liveOptionsFromEnv();

// The waitlist runs where PUBLIC_URL is set (the email links point there). In development it
// defaults to this server; in production it stays off unless set, so the demo has none.
const publicUrl =
  process.env.PUBLIC_URL ||
  (process.env.NODE_ENV === 'production' ? undefined : `http://localhost:${PORT}`);
// Fails here, before the database is opened, if production has no SMTP settings.
const mailer = publicUrl ? mailerFromEnv() : undefined;

// Fails loudly if DB_PATH is not set or the file does not exist (run db:setup first).
const dbPath = resolveDbPath();
const db = openDb(dbPath);
let mifDb: MifDb;
let palette: PaletteColor[];
let canvasSize: CanvasSize;
let canvas: CanvasStore;

try {
  // Version 0 means a file without any applied migration, MifDb cannot work with it.
  console.log(`Database: ${dbPath}, schema version ${getDbVersion(db)}`);
  if (getDbVersion(db) === 0) {
    throw new Error(`Database ${dbPath} has no schema, run "npm run db:setup:dev -w db" first`);
  }
  mifDb = new MifDb(db);
  console.log(`Last event id: ${mifDb.getLastEventId()}`);

  palette = mifDb.getPalette();
  // The frontend cannot work without colors, so fail at start instead of serving an empty list.
  if (palette.length === 0) throw new Error('palette table is empty');
  console.log(`Palette: ${palette.length} colors`);

  canvasSize = mifDb.getCanvasSize();
  console.log(`Canvas size: ${canvasSize.width}x${canvasSize.height}`);

  // Reads the whole event log once; after that GET /api/canvas is served from memory
  canvas = loadCanvas(mifDb, canvasSize);

  if (publicUrl) {
    // Pending addresses whose link has expired are of no use, see confirmWithinMs.
    const removed = mifDb.removeExpiredWaitlist(Date.now() - CONFIRM_WITHIN_MS);
    if (removed > 0) console.log(`Waitlist: removed ${removed} expired unconfirmed addresses`);
  }
  const { eventId, timestamp } = canvas.snapshot();
  console.log(`Canvas loaded up to event ${eventId} (${new Date(timestamp).toISOString()})`);
} catch (e) {
  db.close();
  throw e;
}

const app = createApp({
  canvasSize,
  palette,
  checkDbHealth: () => mifDb.checkHealth(),
  getCanvasState: () => canvas.snapshot(),
  appendEvent: placeAndPublish,
  getLiveStats: () => live.stats(),
  rateLimitPerMinute: 120,
  canvasRateLimitPerMinute: 20,
  pixelRateLimitPerMinute: 10,
  trustProxy,
  waitlist: waitlistOptions(),
});

// The log, memory and the live stream get the same event with the same timestamp, in one
// synchronous step: nothing can read memory or connect between the three.
function placeAndPublish(event: NewEvent): number {
  const placed = placePixel(mifDb, canvas, event);
  live.publish(placed);
  return placed.eventId;
}

function waitlistOptions(): WaitlistOptions | undefined {
  if (!publicUrl || !mailer) {
    console.log('Waitlist: off (PUBLIC_URL is not set)');
    return undefined;
  }
  console.log(`Waitlist: on, email links point to ${publicUrl}`);
  return { store: mifDb, mailer, publicUrl };
}

// The live server is attached before the port opens, so no upgrade request can arrive first.
// Everything in the log up to the loaded checkpoint is in the snapshot; later events go out live.
const server = http.createServer(app);
const live = startLiveServer(
  server,
  {
    checkpoint: () => canvas.checkpoint,
    timestampOf: (id) => mifDb.getEventTimestamp(id),
    eventsBetween: (afterId, toId) =>
      mifDb
        .getEventsBetween(afterId, toId)
        .map((row) => ({ eventId: row.id, pos: row.position, colorId: row.color_id })),
  },
  liveOptions
);

try {
  await listen(server, PORT, hostname);
} catch (error) {
  // Usually the port is taken by another backend (EADDRINUSE)
  console.error(`Cannot listen on http://${hostname}:${PORT}/: ${(error as Error).message}`);
  live.close();
  db.close();
  process.exit(1);
}
console.log(`Server running at http://${hostname}:${PORT}/`);
console.log(
  `Live updates at ws://${hostname}:${PORT}${liveOptions.path}: batches every ${liveOptions.batchMs} ms, up to ${liveOptions.maxConnections} connections`
);

let shuttingDown = false;

const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;

  // Stop the batches, the upgrades and the liveness check, close every client with 1001.
  // Without this server.close() would wait for the open WebSockets until Docker kills the process.
  live.close();

  // Stop HTTP server and then close the database.
  server.close(() => {
    mifDb.close();
  });

  // Close idle HTTP keep-alive connections.
  server.closeIdleConnections();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
