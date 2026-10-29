import express, { type Express, type Response } from 'express';
import type { Server } from 'node:http';
import * as path from 'node:path';
import rateLimit from 'express-rate-limit';
import type {
  CanvasSize,
  CanvasState,
  ErrorResponse,
  PaletteColor,
  PlacePixelResponse,
} from '@mifplace/shared';
import { cellError, toPosition, type NewEvent } from '@mifplace/db';

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
  getCanvasState: () => CanvasState;

  // Throws if the database is not reachable. Injected so the app can be built without a database.
  checkHealth: () => void;
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

  app.get('/', limiter, (req, res) => {
    res.sendFile(path.join(STATIC_PATH, 'index.html'));
  });

  app.get('/api/palette', (_req, res: Response<PaletteColor[]>) => {
    res.json(palette);
  });

  app.get('/api/canvas/size', (_req, res: Response<CanvasSize>) => {
    res.json(canvasSize);
  });

  app.get('/api/canvas', (_req, res: Response<CanvasState>) => {
    res.json(getCanvasState());
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
    const { x, y, colorIndex } = req.body;

    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return res.status(400).json({ success: false, error: 'Coordinates are not a number' });
    }
    if (cellError(canvasSize, x, y) !== undefined) {
      return res.status(400).json({ success: false, error: 'Position not in canvas' });
    }
    if (!paletteIds.has(colorIndex)) {
      return res.status(400).json({ success: false, error: 'Color not in palette' });
    }
    try {
      const eventId = appendEvent({
        user_id: 0, // dev user
        color_id: colorIndex,
        position: toPosition(canvasSize, x, y),
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
