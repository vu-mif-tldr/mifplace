import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CanvasSize, PaletteColor } from '@mifplace/shared';
import { resolveFromRoot } from './env.js';

export type Db = Database.Database;

export interface UserRow {
  id: number;
  name: string;
}

export interface EventRow {
  id: number;
  user_id: number;
  color_id: number;
  position: number;
  timestamp: number;
}

export interface NewEvent {
  user_id: number;
  color_id: number;
  position: number;
}

export interface WaitlistRow {
  id: number;
  email: string;
  token: string;
  created_at: number;
  confirmed_at: number | null;
}

// DB_PATH is required, there is no default. A relative value is resolved against the
// repository root (not the cwd), so the backend, the db scripts, the tools and the MCP
// server open the same file whichever directory they start from.
// Locally it comes from .env (see .env.example), in Docker from ENV.
export function resolveDbPath(): string {
  const fromEnv = process.env.DB_PATH;
  if (fromEnv) return resolveFromRoot(fromEnv);

  throw new Error('resolveDbPath: DB_PATH must be set');
}

// Opens an existing database, never creates one: a wrong DB_PATH must fail loudly
// instead of starting the app on an empty file. Create it with db:setup.
export function openDb(filePath: string): Db {
  if (!fs.existsSync(filePath)) {
    throw new Error(`openDb: Database file not found: ${filePath}`);
  }
  return configureDb(new Database(filePath, { fileMustExist: true }));
}

// Per connection settings, shared by openDb and the db:setup script.
export function configureDb(db: Db): Db {
  // journal_mode is stored in the file, the others are per connection,
  // so everything is set on every open. busy_timeout goes first: switching
  // to WAL needs a lock and must wait for other processes instead of failing.
  // WAL does not work on network file systems (NFS/SMB); in Docker use a
  // named volume for the DB directory, not a bind mount (e.g. on macOS).
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}

// The database version is the number of the last applied migration. SQLite keeps it
// in the header of the file as PRAGMA user_version ("user" here means "set by the
// application", it has nothing to do with the users table). The name is fixed by
// SQLite, so these two functions are the only place that mentions it.
export function getDbVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}

// Thin data access layer over an already opened and migrated database.
export class MifDb {
  private readonly insertEvent;
  private readonly selectEventsAfter;
  private readonly selectPixelHistory;
  private readonly selectLastEventId;
  private readonly selectCanvasSize;
  private readonly selectPalette;
  private readonly healthQuery;
  private readonly appendTx;
  private readonly upsertWaitlist;
  private readonly selectWaitlistByEmail;
  private readonly updateWaitlistConfirmed;
  private readonly deleteWaitlistToken;
  private readonly deletePendingWaitlist;

  constructor(private readonly db: Db) {
    this.insertEvent = db.prepare(
      `INSERT INTO events (user_id, color_id, position, timestamp) 
            VALUES (?, ?, ?, ?)`
    );
    this.selectEventsAfter = db.prepare(`SELECT * FROM events WHERE id > ? ORDER BY id`);
    this.selectPixelHistory = db.prepare(
      'SELECT * FROM events WHERE position = ? ORDER BY id DESC LIMIT ?'
    );
    this.selectLastEventId = db.prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM events`);
    this.selectCanvasSize = db.prepare('SELECT width, height FROM canvas');
    this.selectPalette = db.prepare('SELECT color_id AS id, text AS color FROM palette');
    this.healthQuery = db.prepare('SELECT 1');

    // A repeated signup keeps the token (the link in an earlier email still works) and, while
    // the address is pending, restarts the confirmation period.
    this.upsertWaitlist = db.prepare(
      `INSERT INTO waitlist (email, token, created_at) VALUES (?, ?, ?)
         ON CONFLICT (email) DO UPDATE SET created_at = excluded.created_at
           WHERE confirmed_at IS NULL
         RETURNING *`
    );
    this.selectWaitlistByEmail = db.prepare('SELECT * FROM waitlist WHERE email = ?');
    // Confirming twice keeps the first time. A pending row older than the cutoff is not confirmed.
    this.updateWaitlistConfirmed = db.prepare(
      `UPDATE waitlist SET confirmed_at = COALESCE(confirmed_at, ?)
         WHERE token = ? AND (confirmed_at IS NOT NULL OR created_at >= ?)`
    );
    this.deleteWaitlistToken = db.prepare('DELETE FROM waitlist WHERE token = ?');
    this.deletePendingWaitlist = db.prepare(
      'DELETE FROM waitlist WHERE confirmed_at IS NULL AND created_at < ?'
    );

    // The event and the cooldown timestamp must change together.
    this.appendTx = db.transaction((event: NewEvent, now: number): number => {
      const result = this.insertEvent.run(event.user_id, event.color_id, event.position, now);
      return Number(result.lastInsertRowid);
    });
  }

  checkHealth(): void {
    this.healthQuery.get();
  }

  getCanvasSize(): CanvasSize {
    const wh = this.selectCanvasSize.get() as CanvasSize | undefined;
    if (!wh) throw new Error('getCanvasSize: canvas size is not set');
    return wh;
  }

  getPalette(): PaletteColor[] {
    return this.selectPalette.all() as PaletteColor[];
  }

  // Appends an event to the log and returns its id.
  // Throws if entry violates the schema constraints.
  appendEvent(event: NewEvent, now: number = Date.now()): number {
    return this.appendTx(event, now);
  }

  getLastEventId(): number {
    return (this.selectLastEventId.get() as { id: number }).id;
  }

  // Events with id greater than afterId, used for catching up after a reconnect.
  getEventsAfter(afterId: number): EventRow[] {
    return this.selectEventsAfter.all(afterId) as EventRow[];
  }

  // Events of one cell (see toPosition), newest first. There is no index on position,
  // so this scans the log: fine for the MCP server, not for a request path.
  getPixelHistory(position: number, limit: number): EventRow[] {
    return this.selectPixelHistory.all(position, limit) as EventRow[];
  }

  // Streams events one by one, used to rebuild the canvas on server start
  // without loading the whole log into memory.
  iterateEvents(afterId: number): IterableIterator<EventRow> {
    return this.selectEventsAfter.iterate(afterId) as IterableIterator<EventRow>;
  }

  // Adds an address to the waitlist, or returns the existing row (token unchanged). A pending
  // row gets created_at = now again. RETURNING gives no row when a confirmed address is
  // signed up again (the update is skipped), so that row is read separately.
  addToWaitlist(email: string, token: string, now: number = Date.now()): WaitlistRow {
    const row = this.upsertWaitlist.get(email, token, now) as WaitlistRow | undefined;
    if (row) return row;
    return this.selectWaitlistByEmail.get(email) as WaitlistRow;
  }

  // Marks the address with this token as confirmed. False for an unknown token and for a
  // pending row created before notBefore (the link has expired).
  confirmWaitlist(token: string, notBefore: number, now: number = Date.now()): boolean {
    return this.updateWaitlistConfirmed.run(now, token, notBefore).changes > 0;
  }

  // Deletes the address with this token. False if there was none.
  removeFromWaitlist(token: string): boolean {
    return this.deleteWaitlistToken.run(token).changes > 0;
  }

  // Deletes pending rows created before the cutoff and returns how many.
  removeExpiredWaitlist(before: number): number {
    return this.deletePendingWaitlist.run(before).changes;
  }

  // Online backup that is safe while the server is running.
  backup(destPath: string): Promise<unknown> {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    return this.db.backup(destPath);
  }

  close(): void {
    this.db.close();
  }
}
