// https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Node_server_without_framework
import express from 'express';
import * as path from 'node:path';
import { MifDb, getDbVersion, openDb, resolveDbPath } from './db.js';
import { loadDotEnv } from './env.js';

const app = express();

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
try {
  // Version 0 means a file without any applied migration, MifDb cannot work with it.
  if (getDbVersion(db) === 0) {
    throw new Error(`Database ${dbPath} has no schema, run "npm run db:setup:dev" first`);
  }
  mifDb = new MifDb(db);
  console.log(
    `DB: ${dbPath}, schema version ${getDbVersion(db)}, last event id: ${mifDb.getLastEventId()}`
  );
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
