import Database from 'better-sqlite3';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadDotEnv, resolveDbPath } from '@mifplace/db';
import { createApp } from './app.js';

// stdout is the MCP channel: log only with console.error (loadDotEnv writes nothing there).
// DB_PATH comes from the environment (.mcp.json), then from .env in the repository root.
loadDotEnv();
// Read-only, so it never touches the event log.
const db = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 5000');

serveStdio(() => createApp(db), {
  onerror: (e) => console.error('mifplace MCP error:', e),
});
