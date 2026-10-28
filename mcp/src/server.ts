import Database from 'better-sqlite3';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { resolveDbPath } from '../../backend/src/db.js';
import { createApp } from './app.js';

// stdout is the MCP channel: log only with console.error and do not use loadDotEnv
// (it logs to stdout). Read-only, so it never touches the event log.
const db = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 5000');

serveStdio(() => createApp(db), {
  onerror: (e) => console.error('mifplace MCP error:', e),
});
