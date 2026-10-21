import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { CANVAS_HEIGHT, CANVAS_WIDTH, PALETTE } from '../shared/protocol.ts';
import { EventLog } from './event-log.ts';
import { readJson, sendJson } from './http-util.ts';
import { Hub } from './hub.ts';
import { handleLongPoll, handleShortPoll } from './transports/polling.ts';
import { handleSse } from './transports/sse.ts';
import { WebSocketTransport } from './transports/websocket.ts';

export interface AppOptions {
  port: number;
  host: string;
  batchMs: number;
  heartbeatMs: number;
  maxBacklog: number;
  maxBufferedBytes: number;
  longPollTimeoutMs: number;
  wsPingMs: number;
  sseRetryMinMs: number;
  sseRetryMaxMs: number;
  /** Placements per second made by the server itself, to have traffic without users. 0 = off. */
  botRate: number;
}

export const DEFAULT_OPTIONS: AppOptions = {
  port: 3100,
  host: '127.0.0.1',
  batchMs: 100,
  heartbeatMs: 15_000,
  maxBacklog: 5_000,
  maxBufferedBytes: 256 * 1024,
  longPollTimeoutMs: 25_000,
  wsPingMs: 30_000,
  sseRetryMinMs: 1_000,
  sseRetryMaxMs: 5_000,
  botRate: 0,
};

export interface App {
  url: string;
  log: EventLog;
  hub: Hub;
  close(): Promise<void>;
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const STATIC_DIRS = { public: path.join(ROOT, 'public'), web: path.join(ROOT, 'dist/web') };
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
};
const NOT_FOUND = JSON.stringify({ ok: false, error: 'not found' });

export async function startApp(overrides: Partial<AppOptions> = {}): Promise<App> {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const log = new EventLog();
  const hub = new Hub(log, options);
  const ws = new WebSocketTransport(hub, log, {
    pingMs: options.wsPingMs,
    maxBufferedBytes: options.maxBufferedBytes,
  });
  const requests = { place: 0, lp: 0, poll: 0 };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    switch (`${req.method} ${url.pathname}`) {
      case 'GET /api/canvas':
        return sendJson(res, 200, JSON.stringify(log.snapshot()));
      case 'POST /api/place': {
        requests.place++;
        const result = log.place(await readJson(req, 1024));
        return sendJson(res, result.ok ? 200 : 400, JSON.stringify(result));
      }
      case 'GET /api/sse':
        return handleSse(req, res, url, hub, {
          maxBufferedBytes: options.maxBufferedBytes,
          retryMinMs: options.sseRetryMinMs,
          retryMaxMs: options.sseRetryMaxMs,
        });
      case 'GET /api/lp':
        requests.lp++;
        return handleLongPoll(res, url, hub, options.longPollTimeoutMs);
      case 'GET /api/poll':
        requests.poll++;
        return handleShortPoll(res, url, hub);
      case 'GET /api/stats':
        return sendJson(
          res,
          200,
          JSON.stringify({
            lastEventId: log.lastId,
            flushedId: hub.flushedId,
            connections: hub.counts(),
            requests,
            rssMb: Math.round(process.memoryUsage().rss / 1e6),
          })
        );
      case 'POST /api/debug/drop':
        hub.dropAll();
        res.writeHead(204).end();
        return;
    }
    if (req.method === 'GET') return serveStatic(url.pathname, res);
    sendJson(res, 404, NOT_FOUND);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) res.destroy();
      else sendJson(res, 500, JSON.stringify({ ok: false, error: String(error) }));
    });
  });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname === '/ws') {
      ws.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  hub.start();
  const bot = options.botRate > 0 ? startBot(log, options.botRate) : undefined;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://${options.host}:${port}`,
    log,
    hub,
    async close() {
      clearInterval(bot);
      hub.close();
      ws.close();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}

/** `/` is the page, `/js/*` the compiled client from dist/web. */
async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const [dir, relative] = pathname.startsWith('/js/')
    ? [STATIC_DIRS.web, pathname.slice('/js/'.length)]
    : [STATIC_DIRS.public, pathname === '/' ? 'index.html' : pathname.slice(1)];
  const file = path.resolve(dir, relative);
  if (!file.startsWith(dir + path.sep)) return sendJson(res, 404, NOT_FOUND);
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    sendJson(res, 404, NOT_FOUND);
  }
}

/** A random walk, so that the bot draws lines rather than noise. */
function startBot(log: EventLog, rate: number): NodeJS.Timeout {
  let x = CANVAS_WIDTH / 2;
  let y = CANVAS_HEIGHT / 2;
  let color = 2;
  const step = () => Math.floor(Math.random() * 3) - 1;
  return setInterval(() => {
    x = (x + step() + CANVAS_WIDTH) % CANVAS_WIDTH;
    y = (y + step() + CANVAS_HEIGHT) % CANVAS_HEIGHT;
    if (Math.random() < 0.02) color = Math.floor(Math.random() * PALETTE.length);
    log.place({ x, y, color });
  }, 1000 / rate);
}
