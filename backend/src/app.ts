import express from 'express';
import * as path from 'node:path';

export interface AppConfig {
  gridWidth: number;
  gridHeight: number;
  paletteSize: number;
  // Throws if the database is not reachable. Injected so the app can be built without a database.
  checkHealth: () => void;
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
export function createApp({ gridWidth, gridHeight, paletteSize, checkHealth }: AppConfig) {
  const app = express();

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
  app.post('/api/pixels', (req, res) => {
    const { x, y, colorIndex } = req.body;

    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return res.status(400).json({ success: false, error: 'Coordinates are not a number' });
    } else if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) {
      return res.status(400).json({ success: false, error: ' Position not in canvas' });
    } else if (colorIndex < 0 || colorIndex >= paletteSize) {
      return res.status(400).json({ success: false, error: 'Color not in palette' });
    } else {
      return res.status(201).json({ success: true });
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
