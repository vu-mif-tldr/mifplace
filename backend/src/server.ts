// https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Node_server_without_framework
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { MifDb, getDbVersion, openDb, resolveDbPath } from './db.js';
import { CanvasState, type ContentEncoding } from './canvas-state.js';
import { InvalidPixelError, parsePixel, placePixel, type PixelLimits } from './place-pixel.js';
import { loadDotEnv } from './env.js';

// Settings come from the environment, then from .env (see .env.example).
loadDotEnv('.env');

const PORT: number = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
const hostname: string = process.env.HOST ?? '127.0.0.1';

// Fails loudly if DB_PATH is not set or the file does not exist (run db:setup first).
const dbPath = resolveDbPath();
const db = openDb(dbPath);
let mifDb: MifDb;
// The canvas lives in memory, the database is read once at start.
let canvas: CanvasState;
// The palette is fixed while the server runs, it is serialized once at start.
let paletteJson: string;
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
  canvas = new CanvasState(size, mifDb.getCanvasSnapshot());
  paletteJson = JSON.stringify(palette);
  pixelLimits = {
    cellCount: size.width * size.height,
    colorIds: new Set(palette.map((c) => c.id)),
  };
  console.log(
    `DB: ${dbPath}, schema version ${getDbVersion(db)}, last event id: ${mifDb.getLastEventId()}`
  );
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
    sendJson(res, 201, { id });
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      res.setHeader('Connection', 'close');
      sendJson(res, 413, { error: 'Body is too large' });
    } else if (e instanceof InvalidPixelError) {
      sendJson(res, 400, { error: e.message });
    } else if (e instanceof SyntaxError) {
      sendJson(res, 400, { error: 'Body is not valid JSON' });
    } else {
      // The database error stays in the log, the client only learns that it failed.
      console.error('POST /api/pixel failed:', e);
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

server.listen(PORT, hostname, () => {
  console.log(`Server running at http://${hostname}:${PORT}/`);
});

// Stop accepting connections, then close the database so the WAL is checkpointed.
// The database is closed in the callback: it is not needed until open connections are done.
const shutdown = () => {
  server.close(() => mifDb.close());
  // Idle keep-alive connections would keep server.close waiting.
  server.closeIdleConnections();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
