import { MifDb, getDbVersion, loadDotEnv, openDb, resolveDbPath } from '@mifplace/db';
import type { Server } from 'node:http';
import { createApp, listen } from './app.js';
import type { CanvasStore } from './canvas-state.js';
import { loadCanvas, placePixel } from './canvas-log.js';
import type { CanvasSize, PaletteColor } from '@mifplace/shared';

// Settings come from the environment, then from .env in the repository root (see .env.example).
loadDotEnv();

const PORT: number = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
const hostname: string = process.env.HOST ?? '127.0.0.1';

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
  const { eventId, timestamp } = canvas.snapshot();
  console.log(`Canvas loaded up to event ${eventId} (${new Date(timestamp).toISOString()})`);
} catch (e) {
  db.close();
  throw e;
}

const app = createApp({
  canvasSize,
  palette,
  checkHealth: () => mifDb.checkHealth(),
  getCanvasState: () => canvas.snapshot(),
  appendEvent: (eventObject) => placePixel(mifDb, canvas, eventObject),
});

let server: Server;
try {
  server = await listen(app, PORT, hostname);
} catch (error) {
  // Usually the port is taken by another backend (EADDRINUSE)
  console.error(`Cannot listen on http://${hostname}:${PORT}/: ${(error as Error).message}`);
  db.close();
  process.exit(1);
}
console.log(`Server running at http://${hostname}:${PORT}/`);

// Stop accepting connections, then close the database so the WAL is checkpointed.
// The database is closed in the callback: it is not needed until open connections are done.
const shutdown = () => {
  server.close(() => mifDb.close());
  // Idle keep-alive connections would keep server.close waiting.
  server.closeIdleConnections();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
