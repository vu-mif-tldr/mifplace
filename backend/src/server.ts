// https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Node_server_without_framework
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { MifDb, getDbVersion, openDb, resolveDbPath } from './db.js';
import { CanvasState, DEFAULT_BROTLI_QUALITY, type ContentEncoding } from './canvas-state.js';
import { InvalidPixelError, parsePixel, placePixel, type PixelLimits } from './place-pixel.js';
import { envInt, loadDotEnv } from './env.js';
import { DEFAULT_LIVE_OPTIONS, LiveUpdates, type LiveUpdatesOptions } from './live-updates.js';
import { logger, parseLogLevel, setLogLevel } from './log.js';

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

//Record<string, string> object with any string keys and string values
// need so file.ext would work becasue it expects a string
const MIME_TYPES: Record<string, string> = {
  default: 'application/octet-stream',
  html: 'text/html; charset=UTF-8',
  js: 'text/javascript',
  css: 'text/css',
  png: 'image/png',
};

// There is no sign-in yet, every pixel is written as the dev user from migration 001.
const DEV_USER_ID = 0;
const MAX_BODY_BYTES = 1024;
// How often the summary of the last period is logged, if anything happened.
const STATS_MS = 60_000;

// Counters for the periodic summary, reset after every summary.
const stats = { placed: 0, rejected: 0, clients: 0 };

class BodyTooLargeError extends Error {}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError();
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// POST /api/pixel { position, color_id } -> 201 { id } with the id of the new event.
// The pixel is in the database and in the canvas state, or in neither (see placePixel).
async function handlePlacePixel(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Use POST' });
    return;
  }
  if (!req.headers['content-type']?.startsWith('application/json')) {
    sendJson(res, 415, { error: 'Content-Type must be application/json' });
    return;
  }
  try {
    const pixel = parsePixel(await readJsonBody(req), pixelLimits);
    const id = placePixel(mifDb, canvas, pixel, DEV_USER_ID);
    live.publish({ id, ...pixel });
    stats.placed++;
    httpLog.debug('pixel placed', { id, position: pixel.position, color: pixel.color_id });
    sendJson(res, 201, { id });
  } catch (e) {
    stats.rejected++;
    if (e instanceof BodyTooLargeError) {
      res.setHeader('Connection', 'close');
      httpLog.warn('pixel rejected', { status: 413, reason: 'body is too large' });
      sendJson(res, 413, { error: 'Body is too large' });
    } else if (e instanceof InvalidPixelError) {
      httpLog.warn('pixel rejected', { status: 400, reason: e.message });
      sendJson(res, 400, { error: e.message });
    } else if (e instanceof SyntaxError) {
      httpLog.warn('pixel rejected', { status: 400, reason: 'body is not valid JSON' });
      sendJson(res, 400, { error: 'Body is not valid JSON' });
    } else {
      // The database error stays in the log, the client only learns that it failed.
      httpLog.error('pixel not saved', { status: 500 }, e);
      sendJson(res, 500, { error: 'Could not save the pixel' });
    }
  }
}

// Brotli if the client takes it, then gzip, otherwise no compression. q-values are ignored:
// browsers send both with the default q=1.
function pickEncoding(acceptEncoding: string | undefined): ContentEncoding {
  const accepted = (acceptEncoding ?? '').split(',').map((s) => s.split(';')[0].trim());
  if (accepted.includes('br')) return 'br';
  if (accepted.includes('gzip')) return 'gzip';
  return 'identity';
}

const STATIC_PATH = path.join(process.cwd(), '../frontend/dist');

const toBool = [() => true, () => false];

const prepareFile = async (url: string) => {
  const urlAsPath = decodeURI(url);
  const paths = [STATIC_PATH, urlAsPath];
  if (url.endsWith('/')) paths.push('index.html');
  const filePath = path.join(...paths);

  const pathTraversal = !filePath.startsWith(STATIC_PATH);
  const exists = await fs.promises.access(filePath).then(...toBool);
  //http://127.0.0.1:3000
  const found = !pathTraversal && exists;
  // the fix was if you dont have a 404.html file which it says
  // about here then it will give you an error because cant open
  // a file that is not finding.
  const streamPath = found ? filePath : `${STATIC_PATH}/404.html`;
  const ext = path.extname(streamPath).substring(1).toLowerCase();
  const stream = fs.createReadStream(streamPath);
  return { found, ext, stream };
};

const server = http.createServer(async (req, res) => {
  // Every request at debug level: drawing sends one request per pixel.
  const started = performance.now();
  res.on('finish', () =>
    httpLog.debug(`${req.method} ${req.url}`, {
      status: res.statusCode,
      ms: Math.round(performance.now() - started),
    })
  );

  if (req.url === '/api/palette') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(paletteJson);
    return;
  }

  if (req.url === '/api/pixel') {
    await handlePlacePixel(req, res);
    return;
  }

  // Binary body, the layout is described in CanvasState.
  if (req.url === '/api/canvas') {
    const encoding = pickEncoding(req.headers['accept-encoding']);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Accept-Encoding');
    if (encoding !== 'identity') res.setHeader('Content-Encoding', encoding);
    res.end(canvas.body(encoding));
    return;
  }

  // everyime a request is made it reads the file again
  // fs.createReadStream from disk takes the file and makes it readable
  // ?? checks if the left side is not null of undefined
  // then return the left side.
  const file = await prepareFile(req.url ?? '/');

  const mimeType = MIME_TYPES[file.ext] || MIME_TYPES.default;
  res.statusCode = file.found ? 200 : 404;
  res.setHeader('Content-Type', mimeType);
  // gives file content to res, by chunks 64KB, read one chunk
  // then write to res then frees up then reads next chunk until
  // file end res.end automatically called when file end
  file.stream.pipe(res);
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

server.listen(PORT, hostname, () => {
  log.info('listening', { url: `http://${hostname}:${PORT}/` });
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
