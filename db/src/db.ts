import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CanvasSize, PaletteColor, UserRole } from '@mifplace/shared';
import { resolveFromRoot } from './env.js';

export type Db = Database.Database;

// An account has an email and a password hash; a system user (user 0 of the seed scripts) has
// neither and cannot sign in.
export interface UserRow {
  id: number;
  email: string | null;
  password_hash: string | null;
  role: UserRole;
  created_at: number;
  verified_at: number | null;
  banned_at: number | null;
  ban_reason: string | null;
}

// The user of a session, with the time the session was last seen
export type SessionUserRow = UserRow & { session_last_seen_at: number };

// What a token from an email is for
export type EmailTokenPurpose = 'verify' | 'reset';

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
  private readonly selectEventsBetween;
  private readonly selectEventTimestamp;
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
  private readonly selectUserByEmail;
  private readonly selectUserById;
  private readonly registerUserTx;
  private readonly upsertVerifiedUser;
  private readonly insertEmailToken;
  private readonly selectEmailToken;
  private readonly insertSession;
  private readonly selectSessionUser;
  private readonly updateSessionSeen;
  private readonly deleteSessionByHash;
  private readonly verifyEmailTx;
  private readonly resetPasswordTx;
  private readonly changePasswordTx;
  private readonly removeExpiredAuthTx;

  constructor(private readonly db: Db) {
    this.insertEvent = db.prepare(
      `INSERT INTO events (user_id, color_id, position, timestamp) 
            VALUES (?, ?, ?, ?)`
    );
    this.selectEventsAfter = db.prepare(`SELECT * FROM events WHERE id > ? ORDER BY id`);
    this.selectEventsBetween = db.prepare(
      `SELECT * FROM events WHERE id > ? AND id <= ? ORDER BY id`
    );
    this.selectEventTimestamp = db.prepare(`SELECT timestamp FROM events WHERE id = ?`);
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

    this.selectUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
    this.selectUserById = db.prepare('SELECT * FROM users WHERE id = ?');
    // A repeated registration of an address that is not verified yet replaces the password and
    // restarts the day it has to be verified in. A verified account is left alone (no row back).
    const upsertPendingUser = db.prepare(
      `INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = excluded.password_hash, created_at = excluded.created_at
           WHERE verified_at IS NULL
         RETURNING *`
    );
    this.upsertVerifiedUser = db.prepare(
      `INSERT INTO users (email, password_hash, created_at, verified_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = excluded.password_hash,
               verified_at = COALESCE(verified_at, excluded.verified_at)
         RETURNING *`
    );
    this.insertEmailToken = db.prepare(
      'INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)'
    );
    this.selectEmailToken = db.prepare(
      'SELECT user_id FROM email_tokens WHERE token_hash = ? AND purpose = ? AND expires_at > ?'
    );
    this.insertSession = db.prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`
    );
    this.selectSessionUser = db.prepare(
      `SELECT u.*, s.last_seen_at AS session_last_seen_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`
    );
    this.updateSessionSeen = db.prepare(
      'UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?'
    );
    this.deleteSessionByHash = db.prepare('DELETE FROM sessions WHERE token_hash = ?');

    const setVerified = db.prepare(
      'UPDATE users SET verified_at = COALESCE(verified_at, ?) WHERE id = ?'
    );
    const setPassword = db.prepare(
      'UPDATE users SET password_hash = ? WHERE id = ? AND email IS NOT NULL'
    );
    const deleteTokensOf = db.prepare('DELETE FROM email_tokens WHERE user_id = ?');
    const deleteVerifyTokensOf = db.prepare(
      `DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'verify'`
    );
    const deleteSessionsOf = db.prepare('DELETE FROM sessions WHERE user_id = ?');
    const deleteOtherSessionsOf = db.prepare(
      'DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?'
    );
    const deleteExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
    const deleteExpiredTokens = db.prepare('DELETE FROM email_tokens WHERE expires_at <= ?');
    // Run after the expired tokens are gone: a token left means a link that still works
    const deleteUnverifiedUsers = db.prepare(
      `DELETE FROM users
         WHERE email IS NOT NULL AND verified_at IS NULL AND created_at < ?
           AND NOT EXISTS (SELECT 1 FROM email_tokens t WHERE t.user_id = users.id)`
    );

    // Links from earlier emails stop working: the address is verified only through the email
    // of the registration whose password the account now has.
    this.registerUserTx = db.transaction(
      (email: string, passwordHash: string, now: number): UserRow | undefined => {
        const row = upsertPendingUser.get(email, passwordHash, now) as UserRow | undefined;
        if (row) deleteVerifyTokensOf.run(row.id);
        return row;
      }
    );

    // The token is checked and used up in one step, so it works once.
    this.verifyEmailTx = db.transaction((tokenHash: string, now: number): UserRow | undefined => {
      const token = this.selectEmailToken.get(tokenHash, 'verify', now) as
        { user_id: number } | undefined;
      if (!token) return undefined;
      setVerified.run(now, token.user_id);
      deleteVerifyTokensOf.run(token.user_id);
      return this.selectUserById.get(token.user_id) as UserRow;
    });

    // The new password, the used-up token and the closed sessions must change together.
    this.resetPasswordTx = db.transaction(
      (tokenHash: string, passwordHash: string, now: number): UserRow | undefined => {
        const token = this.selectEmailToken.get(tokenHash, 'reset', now) as
          { user_id: number } | undefined;
        if (!token) return undefined;
        setPassword.run(passwordHash, token.user_id);
        // The link came by email, so the address is verified too
        setVerified.run(now, token.user_id);
        deleteTokensOf.run(token.user_id);
        deleteSessionsOf.run(token.user_id);
        return this.selectUserById.get(token.user_id) as UserRow;
      }
    );

    this.changePasswordTx = db.transaction(
      (userId: number, passwordHash: string, keepSessionHash: string): void => {
        setPassword.run(passwordHash, userId);
        deleteTokensOf.run(userId);
        deleteOtherSessionsOf.run(userId, keepSessionHash);
      }
    );

    this.removeExpiredAuthTx = db.transaction((now: number, unverifiedBefore: number) => ({
      sessions: deleteExpiredSessions.run(now).changes,
      tokens: deleteExpiredTokens.run(now).changes,
      users: deleteUnverifiedUsers.run(unverifiedBefore).changes,
    }));

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

  // Events with ids in (afterId, toId], in order: what a reconnecting client missed up to the
  // last event the server has sent (catch-up, docs/api.md).
  getEventsBetween(afterId: number, toId: number): EventRow[] {
    return this.selectEventsBetween.all(afterId, toId) as EventRow[];
  }

  // The timestamp of one event, undefined when there is no event with that id. A client's
  // checkpoint is valid only when both match (ADR-0003: ids can be reused after a restore).
  getEventTimestamp(id: number): number | undefined {
    return (this.selectEventTimestamp.get(id) as { timestamp: number } | undefined)?.timestamp;
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

  // The account with this address (as stored: trimmed, lower case), verified or not.
  findUserByEmail(email: string): UserRow | undefined {
    return this.selectUserByEmail.get(email) as UserRow | undefined;
  }

  // Creates an account that still has to verify its address, or, if the address has one that
  // is not verified yet, replaces its password and drops its earlier 'verify' tokens. pending
  // is false when the address belongs to a verified account: that one is returned unchanged.
  registerUser(
    email: string,
    passwordHash: string,
    now: number = Date.now()
  ): { user: UserRow; pending: boolean } {
    const row = this.registerUserTx(email, passwordHash, now);
    if (row) return { user: row, pending: true };
    return { user: this.selectUserByEmail.get(email) as UserRow, pending: false };
  }

  // Creates an account whose address counts as verified, or, if the address has an account,
  // sets its password (and verifies it). For the development account the backend makes at
  // start; a registration goes through registerUser and the email.
  ensureVerifiedUser(email: string, passwordHash: string, now: number = Date.now()): UserRow {
    return this.upsertVerifiedUser.get(email, passwordHash, now, now) as UserRow;
  }

  // Stores the hash of a token that goes out in an email.
  addEmailToken(
    tokenHash: string,
    userId: number,
    purpose: EmailTokenPurpose,
    expiresAt: number
  ): void {
    this.insertEmailToken.run(tokenHash, userId, purpose, expiresAt);
  }

  // Is this a token for that purpose that has not expired? It stays usable.
  hasEmailToken(tokenHash: string, purpose: EmailTokenPurpose, now: number = Date.now()): boolean {
    return this.selectEmailToken.get(tokenHash, purpose, now) !== undefined;
  }

  // Uses up a 'verify' token: marks the address of its account as verified and returns the
  // account. Undefined for an unknown, used or expired token.
  verifyEmail(tokenHash: string, now: number = Date.now()): UserRow | undefined {
    return this.verifyEmailTx(tokenHash, now);
  }

  // Uses up a 'reset' token: sets the new password hash and closes every session of the
  // account. Undefined for an unknown, used or expired token.
  resetPassword(
    tokenHash: string,
    passwordHash: string,
    now: number = Date.now()
  ): UserRow | undefined {
    return this.resetPasswordTx(tokenHash, passwordHash, now);
  }

  // Sets a new password hash and closes every session of the account but the one given.
  changePassword(userId: number, passwordHash: string, keepSessionHash: string): void {
    this.changePasswordTx(userId, passwordHash, keepSessionHash);
  }

  createSession(
    tokenHash: string,
    userId: number,
    expiresAt: number,
    now: number = Date.now()
  ): void {
    this.insertSession.run(tokenHash, userId, now, expiresAt, now);
  }

  // The user of a session that has not expired. A blocked user is returned too (banned_at),
  // the caller decides.
  findSession(tokenHash: string, now: number = Date.now()): SessionUserRow | undefined {
    return this.selectSessionUser.get(tokenHash, now) as SessionUserRow | undefined;
  }

  touchSession(tokenHash: string, now: number = Date.now()): void {
    this.updateSessionSeen.run(now, tokenHash);
  }

  // Signs one browser out. False if there was no such session.
  deleteSession(tokenHash: string): boolean {
    return this.deleteSessionByHash.run(tokenHash).changes > 0;
  }

  // Deletes expired sessions and tokens, and accounts created before unverifiedBefore that
  // never verified their address and have no link left that still works (a link sent again
  // later keeps its account until it expires). Returns how many of each.
  removeExpiredAuth(
    now: number,
    unverifiedBefore: number
  ): { sessions: number; tokens: number; users: number } {
    return this.removeExpiredAuthTx(now, unverifiedBefore);
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
