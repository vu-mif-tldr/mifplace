import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

export interface Color {
  id: number;
  // "#RRGGBB"
  rgb: string;
}

export interface CanvasSize {
  width: number;
  height: number;
}

// Current color of one painted cell (position = y * width + x).
export interface Pixel {
  position: number;
  color_id: number;
}

// Painted cells together with the id of the last event they include.
export interface CanvasSnapshot {
  lastEventId: number;
  pixels: Pixel[];
}

export interface NewEvent {
  user_id: number;
  color_id: number;
  position: number;
}

// DB_PATH is required, there is no default: a process started from another
// directory must never silently create a second database.
// Locally it comes from .env (see .env.example), in Docker from ENV.
export function resolveDbPath(): string {
  const fromEnv = process.env.DB_PATH;
  if (fromEnv) return fromEnv;

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
  private readonly selectLastEventId;
  private readonly appendTx;
  private readonly selectPalette;
  private readonly selectCanvasSize;
  private readonly selectPixels;
  private readonly snapshotTx;

  constructor(private readonly db: Db) {
    this.selectPalette = db.prepare(`SELECT color_id AS id, rgb FROM palette ORDER BY color_id`);
    this.selectCanvasSize = db.prepare(`SELECT width, height FROM canvas`);
    // The last event of every position wins. Positions are validated before an event is
    // appended, so there is no bounds check here.
    this.selectPixels = db.prepare(
      `SELECT position, color_id FROM events
        WHERE id IN (SELECT MAX(id) FROM events GROUP BY position)`
    );
    this.insertEvent = db.prepare(
      `INSERT INTO events (user_id, color_id, position, timestamp) 
            VALUES (?, ?, ?, ?)`
    );
    this.selectEventsAfter = db.prepare(`SELECT * FROM events WHERE id > ? ORDER BY id`);
    this.selectLastEventId = db.prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM events`);

    // Both reads in one transaction, so lastEventId matches the pixels exactly.
    this.snapshotTx = db.transaction((): CanvasSnapshot => ({
      lastEventId: this.getLastEventId(),
      pixels: this.selectPixels.all() as Pixel[],
    }));

    // The event and the cooldown timestamp must change together.
    this.appendTx = db.transaction((event: NewEvent, now: number): number => {
      const result = this.insertEvent.run(event.user_id, event.color_id, event.position, now);
      return Number(result.lastInsertRowid);
    });
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

  // Streams events one by one, used to rebuild the canvas on server start
  // without loading the whole log into memory.
  iterateEvents(afterId: number): IterableIterator<EventRow> {
    return this.selectEventsAfter.iterate(afterId) as IterableIterator<EventRow>;
  }

  // The palette and the canvas size do not change while the server runs,
  // so the caller is expected to read them once and keep the result.
  getPalette(): Color[] {
    const palette = this.selectPalette.all() as Color[];
    if (palette.length === 0) throw new Error('getPalette: palette is not set');
    return palette;
  }

  getCanvasSize(): CanvasSize {
    const size = this.selectCanvasSize.get() as CanvasSize | undefined;
    if (!size) throw new Error('getCanvasSize: canvas size is not set');
    return size;
  }

  // Current state of the canvas: only painted cells, in no particular order, and the id of
  // the last event in it. A client that loads it catches up with the events after that id.
  getCanvasSnapshot(): CanvasSnapshot {
    return this.snapshotTx();
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
