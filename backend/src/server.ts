// https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Node_server_without_framework
import express, { type NextFunction, type Request, type Response } from 'express';
import * as path from 'node:path';
import { MifDb, getDbVersion, openDb, resolveDbPath } from '@mifplace/db';
import { CanvasState, DEFAULT_BROTLI_QUALITY, type ContentEncoding } from './canvas-state.js';
import { InvalidPixelError, parsePixel, placePixel, type PixelLimits } from './place-pixel.js';
import { DEFAULT_LIVE_OPTIONS, LiveUpdates, type LiveUpdatesOptions } from './live-updates.js';
import { envInt, loadDotEnv, logger, parseLogLevel, setLogLevel } from '@mifplace/server-lib';

const app = express();

// Settings come from the environment, then from .env (see .env.example).
loadDotEnv('.env');
setLogLevel(parseLogLevel(process.env.LOG_LEVEL));
const log = logger('server');
const httpLog = logger('http');

const PORT = envInt('PORT', 3000, 0, 65535);
const hostname: string = process.env.HOST ?? '127.0.0.1';
const BROTLI_QUALITY = envInt('CANVAS_BROTLI_QUALITY', DEFAULT_BROTLI_QUALITY, 0, 11);
const LIVE_OPTIONS: LiveUpdatesOptions = {
  batchMs: envInt('WS_BATCH_MS', DEFAULT_LIVE_OPTIONS.batchMs, 10, 10_000),
  maxCatchUp: envInt('WS_MAX_CATCH_UP', DEFAULT_LIVE_OPTIONS.maxCatchUp, 0, 1_000_000),
  maxBufferedBytes: envInt(
    'WS_MAX_BUFFERED_BYTES',
    DEFAULT_LIVE_OPTIONS.maxBufferedBytes,
    64 * 1024,
    256 * 1024 * 1024
  ),
  pingMs: envInt('WS_PING_MS', DEFAULT_LIVE_OPTIONS.pingMs, 1000, 600_000),
};

// Fails loudly if DB_PATH is not set or the file does not exist (run db:setup first).
const dbPath = resolveDbPath();
const db = openDb(dbPath);
let mifDb: MifDb;
// The canvas lives in memory, the database is read once at start.
let canvas: CanvasState;
// The palette is fixed while the server runs, it is serialized once at start.
let paletteJson: string;
// Pushes new pixels to the browsers over /api/ws.
let live: LiveUpdates;
// What POST /api/pixel is checked against, also fixed while the server runs.
let pixelLimits: PixelLimits;
try {
  // Version 0 means a file without any applied migration, MifDb cannot work with it.
  if (getDbVersion(db) === 0) {
    throw new Error(`Database ${dbPath} has no schema, run "npm run db:setup:dev" first`);
  }
  mifDb = new MifDb(db);
  const size = mifDb.getCanvasSize();
  const palette = mifDb.getPalette();
  const tooLarge = palette.find((c) => c.id > CanvasState.MAX_COLOR_ID);
  if (tooLarge) {
    throw new Error(
      `color_id ${tooLarge.id} does not fit CanvasState (max ${CanvasState.MAX_COLOR_ID})`
    );
  }
  const loadStarted = performance.now();
  const snapshot = mifDb.getCanvasSnapshot();
  canvas = new CanvasState(size, snapshot.pixels, snapshot.lastEventId, BROTLI_QUALITY);
  live = new LiveUpdates(mifDb, snapshot.lastEventId, LIVE_OPTIONS);
  paletteJson = JSON.stringify(palette);
  pixelLimits = {
    cellCount: size.width * size.height,
    colorIds: new Set(palette.map((c) => c.id)),
  };
  log.info('canvas loaded', {
    db: dbPath,
    schema: getDbVersion(db),
    size: `${size.width}x${size.height}`,
    colors: palette.length,
    painted: snapshot.pixels.length,
    lastEventId: snapshot.lastEventId,
    ms: Math.round(performance.now() - loadStarted),
  });
  log.info('settings', { ...LIVE_OPTIONS, brotliQuality: BROTLI_QUALITY });
} catch (e) {
  db.close();
  throw e;
}

type HealthResponse = {
  status: 'ok' | 'down';
  DB: {
    status: 'ok' | 'down';
    latencyMs?: string;
  };
  WS: Record<string, never>;
};

// There is no sign-in yet, every pixel is written as the dev user from migration 001.
const DEV_USER_ID = 0;
const MAX_BODY_BYTES = 1024;
// How often the summary of the last period is logged, if anything happened.
const STATS_MS = 60_000;

// Counters for the periodic summary, reset after every summary.
const stats = { placed: 0, rejected: 0, clients: 0 };

// Every request at debug level: drawing sends one request per pixel.
app.use((req, res, next) => {
  const started = performance.now();
  res.on('finish', () =>
    httpLog.debug(`${req.method} ${req.url}`, {
      status: res.statusCode,
      ms: Math.round(performance.now() - started),
    })
  );
  next();
});

app.get('/api/palette', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(paletteJson);
});

// Brotli if the client takes it, then gzip, otherwise no compression. q-values are ignored:
// browsers send both with the default q=1.
function pickEncoding(acceptEncoding: string | undefined): ContentEncoding {
  const accepted = (acceptEncoding ?? '').split(',').map((s) => s.split(';')[0].trim());
  if (accepted.includes('br')) return 'br';
  if (accepted.includes('gzip')) return 'gzip';
  return 'identity';
}

// Binary body, the layout is described in CanvasState.
app.get('/api/canvas', (req, res) => {
  const encoding = pickEncoding(req.headers['accept-encoding']);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Accept-Encoding');
  if (encoding !== 'identity') res.setHeader('Content-Encoding', encoding);
  res.end(canvas.body(encoding));
});

// POST /api/pixel { position, color_id } -> 201 { id } with the id of the new event.
// The pixel is in the database and in the canvas state, or in neither (see placePixel).
app
  .route('/api/pixel')
  .post(
    (req, res, next) => {
      if (!req.headers['content-type']?.startsWith('application/json')) {
        res.status(415).json({ error: 'Content-Type must be application/json' });
        return;
      }
      next();
    },
    express.json({ limit: MAX_BODY_BYTES, strict: false }),
    (req, res) => {
      try {
        const pixel = parsePixel(req.body, pixelLimits);
        const id = placePixel(mifDb, canvas, pixel, DEV_USER_ID);
        live.publish({ id, ...pixel });
        stats.placed++;
        httpLog.debug('pixel placed', { id, position: pixel.position, color: pixel.color_id });
        res.status(201).json({ id });
      } catch (e) {
        stats.rejected++;
        if (e instanceof InvalidPixelError) {
          httpLog.warn('pixel rejected', { status: 400, reason: e.message });
          res.status(400).json({ error: e.message });
        } else {
          // The database error stays in the log, the client only learns that it failed.
          httpLog.error('pixel not saved', { status: 500 }, e);
          res.status(500).json({ error: 'Could not save the pixel' });
        }
      }
    }
  )
  .all((_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Use POST' });
  });

// Errors of the body parser: too large or not valid JSON.
app.use('/api/pixel', (err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.too.large') {
    stats.rejected++;
    res.setHeader('Connection', 'close');
    httpLog.warn('pixel rejected', { status: 413, reason: 'body is too large' });
    res.status(413).json({ error: 'Body is too large' });
  } else if (type === 'entity.parse.failed') {
    stats.rejected++;
    httpLog.warn('pixel rejected', { status: 400, reason: 'body is not valid JSON' });
    res.status(400).json({ error: 'Body is not valid JSON' });
  } else {
    next(err);
  }
});

app.get('/health', (_req, res) => {
  try {
    const start = performance.now();
    mifDb.checkHealth();
    const latencyMs = performance.now() - start;

    const response: HealthResponse = {
      status: 'ok',
      DB: {
        status: 'ok',
        latencyMs: latencyMs.toFixed(2),
      },
      WS: {},
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Database health check failed:', error);

    const response: HealthResponse = {
      status: 'down',
      DB: {
        status: 'down',
      },
      WS: {},
    };

    res.status(503).json(response);
  }
});

const STATIC_PATH = path.join(process.cwd(), '../frontend/dist');
// Express serves static files (HTML, CSS, JS, etc.) from this directory.
// It handles file lookup, Content-Type headers, and streaming automatically.
app.use(express.static(STATIC_PATH));

// Show our custom 404 page when no static file matches the request.
app.use((_req, res) => {
  res.status(404).sendFile(path.join(process.cwd(), '../frontend/public/404.html'));
});

// Start the Express HTTP server and keep a reference for shutdown.
const server = app.listen(PORT, hostname, () => {
  log.info('listening', { url: `http://${hostname}:${PORT}/` });
});

// WebSocket connections start as an HTTP upgrade request; only /api/ws accepts them.
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '', 'http://localhost').pathname === '/api/ws') {
    live.handleUpgrade(req, socket, head);
  } else {
    httpLog.warn('websocket upgrade on an unknown path', { url: req.url });
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  }
});

// A line per period with what happened, skipped while the server is idle.
const statsTimer = setInterval(() => {
  const clients = live.clientCount;
  if (stats.placed === 0 && stats.rejected === 0 && clients === stats.clients) return;
  log.info('summary', {
    seconds: STATS_MS / 1000,
    placed: stats.placed,
    rejected: stats.rejected,
    clients,
    lastEventId: canvas.getLastEventId(),
  });
  stats.placed = 0;
  stats.rejected = 0;
  stats.clients = clients;
}, STATS_MS);

// Stop accepting connections, then close the database so the WAL is checkpointed.
// The database is closed in the callback: it is not needed until open connections are done.
const shutdown = (signal: string) => {
  log.info('shutting down', { signal, clients: live.clientCount });
  clearInterval(statsTimer);
  // Upgraded connections are not tracked by server.close, they would keep the process alive.
  live.close();
  server.close(() => {
    mifDb.close();
    log.info('stopped');
  });
  // Idle keep-alive connections would keep server.close waiting.
  server.closeIdleConnections();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
