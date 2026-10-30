import express, { type Express, type Response } from 'express';
import type { Server } from 'node:http';
import * as path from 'node:path';
import rateLimit from 'express-rate-limit';
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

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // limit each IP to 20 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.',
});

export interface AppConfig {
  // Read once at start: the canvas size does not change while the server runs.
  canvasSize: CanvasSize;
  // Read once at start: the palette does not change while the server runs.
  palette: PaletteColor[];
  // The snapshot for GET /api/canvas, with the checkpoint of its last event
  getCanvasState: () => CanvasState;

  // Throws if the database is not reachable. Injected so the app can be built without a database.
  checkHealth: () => void;
  // Saves a new pixel and returns its event id
  appendEvent: (event: NewEvent) => number;
}

type HealthResponse = {
  status: 'ok' | 'down';
  DB: {
    status: 'ok' | 'down';
    latencyMs?: string;
  };
  WS: Record<string, never>;
};

// Builds the Express app from plain values: it does not read .env or open the database,
// so tests can create it without any setup. server.ts wires in the real values.
export function createApp({
  canvasSize,
  palette,
  checkHealth,
  getCanvasState,
  appendEvent,
}: AppConfig) {
  const app = express();
  // Holds only palette ids, so any other colorIndex (missing, string, fraction, null...) is rejected.
  const paletteIds = new Set(palette.map(({ id }) => id));
  // The size does not change while the server runs, so the position check is built once
  const cell = positionSchema(canvasSize);

  app.get('/', limiter, (req, res) => {
    res.sendFile(path.join(STATIC_PATH, 'index.html'));
  });

  app.get('/api/palette', (_req, res: Response<PaletteColor[]>) => {
    res.json(palette);
  });

  app.get('/api/canvas/size', (_req, res: Response<CanvasSize>) => {
    res.json(canvasSize);
  });

  app.get('/api/canvas', (_req, res: Response<CanvasState | ErrorResponse>) => {
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

  // need this for req.body because can only hold json but without it gives string.
  // Which req.body doesnt accept
  app.use(express.json());
  app.post('/api/pixels', (req, res: Response<PlacePixelResponse | ErrorResponse>) => {
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
        user_id: 0, // dev user
        color_id: colorIndex,
        position: position.data,
      });

      return res.status(201).json({ success: true, eventId });
    } catch (error) {
      console.error('Insert failed:', error);
      return res.status(500).json({ success: false, error: 'Insert failed' });
    }
  });

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

// Starts the server. Resolves once it listens, rejects if it cannot (e.g. EADDRINUSE when
// another backend has the port). Express 5 does not throw in that case, it passes the error
// to the listen callback, and the server would stay without a port.
export function listen(app: Express, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, (error?: Error) => {
      if (error) reject(error);
      else resolve(server);
    });
  });
}
