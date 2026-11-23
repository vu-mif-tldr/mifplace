import express, { type Response } from 'express';
import type { Server } from 'node:http';
import * as path from 'node:path';
import {
  PlacePixelRequestSchema,
  positionSchema,
  zodErrorMessage,
  type CanvasSize,
  type CanvasState,
  type ErrorResponse,
  type PaletteColor,
  type PlacePixelResponse,
} from '@mifplace/shared';
import type { NewEvent } from '@mifplace/db';
import { requireSession, sameOrigin, sessionUser } from './auth/guard.js';
import { createAuthRouter, type AuthOptions } from './auth/router.js';
import { createSessions } from './auth/sessions.js';
import { createWaitlistRouter, type WaitlistOptions } from './waitlist.js';
import type { LiveStats } from './live/live-server.js';
import { DEFAULT_RATE_LIMITS, limiter, type RateLimits } from './rate-limits.js';

export interface AppConfig {
  // Read once at start: the canvas size does not change while the server runs.
  canvasSize: CanvasSize;
  // Read once at start: the palette does not change while the server runs.
  palette: PaletteColor[];
  // The snapshot for GET /api/canvas, with the checkpoint of its last event
  getCanvasState: () => CanvasState;

  // The commit shown by GET /health: APP_COMMIT from the image build. Left out, "dev".
  commit?: string;
  // Throws if the database is not reachable. Injected so the app can be built without a database.
  checkDbHealth: () => void;
  // Saves a new pixel, sends it to the open pages and returns its event id
  appendEvent: (event: NewEvent) => number;
  // The WebSocket connections for GET /health. Left out, WS is empty (tests without a live server).
  getLiveStats?: () => LiveStats;
  // Requests per IP for every endpoint (rate-limits.ts); left out ones keep their defaults.
  // Shared public IPs such as campus Wi-Fi can burst together, so the defaults of the reads are
  // high enough to avoid false positives while still protecting the app from abuse.
  rateLimits?: Partial<RateLimits>;
  // Express "trust proxy": which proxies may set X-Forwarded-For. Behind Caddy it must be set,
  // otherwise every request has the proxy's address and the per-IP limits become global.
  trustProxy?: boolean | number | string;
  // The waitlist on vu.place (POST /api/waitlist...). Left out, the routes do not exist.
  waitlist?: WaitlistOptions;
  // The accounts (/api/auth/...). With them every other /api route needs a session. Left
  // out (tests of single routes; the server always passes it), there are no accounts, the
  // routes are open and pixels belong to the system user.
  auth?: AuthOptions;
}

// User 0 of the database: it has no address and no password (migration 007). The seed
// scripts place pixels as it.
const SYSTEM_USER_ID = 0;

type HealthResponse = {
  status: 'ok' | 'down';
  commit: string;
  DB: {
    status: 'ok' | 'down';
    latencyMs?: string;
  };
  WS: LiveStats | Record<string, never>;
};

// Builds the Express app from plain values: it does not read .env or open the database,
// so tests can create it without any setup. server.ts wires in the real values.
export function createApp({
  commit = 'dev',
  canvasSize,
  palette,
  checkDbHealth: checkHealth,
  getCanvasState,
  appendEvent,
  getLiveStats,
  rateLimits,
  trustProxy = false,
  waitlist,
  auth,
}: AppConfig) {
  const app = express();
  app.set('trust proxy', trustProxy);

  // Every endpoint has its own limiter, counted on its own; /health has none, so the liveness
  // check stays available. A limiter goes before the body is parsed.
  const limits = { ...DEFAULT_RATE_LIMITS, ...rateLimits };

  // Holds only palette ids, so any other colorIndex (missing, string, fraction, null...) is rejected.
  const paletteIds = new Set(palette.map(({ id }) => id));
  // The size does not change while the server runs, so the position check is built once
  const cell = positionSchema(canvasSize);

  // The public part of the API: the waitlist and the accounts.
  if (waitlist) app.use('/api/waitlist', createWaitlistRouter(waitlist, limits));

  if (auth) {
    const sessions = auth.sessions ?? createSessions(auth);
    app.use('/api/auth', createAuthRouter({ ...auth, sessions }, limits));
    // Closed by default: everything under /api from here on needs a session, so a route
    // added below is protected without saying so. A request that changes something must
    // also come from our own page.
    app.use('/api', requireSession(sessions), sameOrigin(auth.allowedOrigins ?? []));
  }

  app.get(
    '/api/palette',
    limiter(limits.palettePerMinute),
    (_req, res: Response<PaletteColor[]>) => {
      res.json(palette);
    }
  );

  app.get(
    '/api/canvas/size',
    limiter(limits.canvasSizePerMinute),
    (_req, res: Response<CanvasSize>) => {
      res.json(canvasSize);
    }
  );

  const canvasLimiter = limiter(
    limits.canvasPerMinute,
    'Too many requests for /api/canvas, please try again later.'
  );
  app.get('/api/canvas', canvasLimiter, (_req, res: Response<CanvasState | ErrorResponse>) => {
    // A failure is a 500 with the error body of the API, never a partial snapshot
    try {
      res.json(getCanvasState());
    } catch (error) {
      console.error('Canvas snapshot failed:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  app.get('/health', (_req, res) => {
    try {
      const start = performance.now();
      checkHealth();
      const latencyMs = performance.now() - start;

      const response: HealthResponse = {
        status: 'ok',
        commit,
        DB: {
          status: 'ok',
          latencyMs: latencyMs.toFixed(2),
        },
        WS: getLiveStats?.() ?? {},
      };

      res.status(200).json(response);
    } catch (error) {
      console.error('Database health check failed:', error);

      const response: HealthResponse = {
        status: 'down',
        commit,
        DB: {
          status: 'down',
        },
        WS: getLiveStats?.() ?? {},
      };

      res.status(503).json(response);
    }
  });

  const pixelLimiter = limiter(
    limits.pixelsPerMinute,
    'Too many pixel submissions, please try again later.'
  );
  // express.json() fills req.body from the JSON body; without it req.body stays undefined
  app.post(
    '/api/pixels',
    pixelLimiter,
    express.json(),
    (req, res: Response<PlacePixelResponse | ErrorResponse>) => {
      // A missing or non-JSON body leaves req.body undefined, the schema rejects it too
      const body = PlacePixelRequestSchema.safeParse(req.body);
      if (!body.success) {
        return res.status(400).json({ success: false, error: zodErrorMessage(body.error) });
      }
      // The client computes the position, the server checks it is on the canvas
      const position = cell.safeParse(body.data);
      if (!position.success) {
        return res.status(400).json({ success: false, error: zodErrorMessage(position.error) });
      }
      const { colorIndex } = body.data;
      // Which colors exist is a rule of the server, not of the request shape
      if (!paletteIds.has(colorIndex)) {
        return res.status(400).json({ success: false, error: 'Color not in palette' });
      }
      try {
        const eventId = appendEvent({
          // Without accounts (see AppConfig.auth) nobody is signed in
          user_id: sessionUser(res)?.id ?? SYSTEM_USER_ID,
          color_id: colorIndex,
          position: position.data,
        });

        return res.status(201).json({ success: true, eventId });
      } catch (error) {
        console.error('Insert failed:', error);
        return res.status(500).json({ success: false, error: 'Insert failed' });
      }
    }
  );

  // Everything not answered above: the page itself, its files and the 404 page
  app.use(limiter(limits.otherPerMinute));

  const STATIC_PATH = path.join(process.cwd(), '../frontend/dist');

  // Express serves static files (HTML, CSS, JS, etc.) from this directory.
  // It handles file lookup, Content-Type headers, and streaming automatically.
  app.use(express.static(STATIC_PATH));

  // Show our custom 404 page when no static file matches the request.
  app.use((_req, res) => {
    res.status(404).sendFile(path.join(STATIC_PATH, '404.html'));
  });

  return app;
}

// Starts the server (http.createServer(app), so the WebSocket transport can be attached to it
// first). Resolves once it listens, rejects if it cannot (e.g. EADDRINUSE when another backend
// has the port): the server emits that as an error event, which would otherwise crash the process.
export function listen(server: Server, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
