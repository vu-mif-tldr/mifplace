import type { CookieOptions, Response } from 'express';
import type { SessionUserRow } from '@mifplace/db';
import type { UserRole } from '@mifplace/shared';
import { TOKEN_PATTERN, hashToken, newToken } from './tokens.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// A browser stays signed in this long after signing in
export const SESSION_TTL_MS = 90 * DAY;
// last_seen_at is written at most this often, not on every request
const TOUCH_EVERY_MS = HOUR;

// What the sessions need from the database (MifDb implements it)
export interface SessionStore {
  createSession(tokenHash: string, userId: number, expiresAt: number, now: number): void;
  findSession(tokenHash: string, now: number): SessionUserRow | undefined;
  touchSession(tokenHash: string, now: number): void;
  deleteSession(tokenHash: string): boolean;
}

// Which sessions just ended, for whoever holds something open for them (the live connections):
// every session of a user, optionally but one, or one session by the hash of its token.
export type SessionsEnded = { userId: number; exceptSession?: string } | { session: string };

// The signed-in user of a request
export interface SessionUser {
  id: number;
  email: string;
  role: UserRole;
  // Identifies the session of this request, e.g. to keep it when the others are closed
  tokenHash: string;
}

// The value of one cookie from a Cookie header, undefined if it is not there.
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

// Sessions are rows in the database, the browser holds a random token in a cookie:
// - HttpOnly: scripts of the page cannot read it;
// - Secure (over HTTPS): never sent without TLS; with the __Host- prefix the browser also
//   refuses a cookie of that name set by a subdomain or without Secure;
// - SameSite=Lax: not sent with requests that other sites make, except top-level navigation.
// Signing out, a ban or a new password delete the row, which takes effect on the next request.
export class Sessions {
  readonly cookieName: string;
  private readonly cookieOptions: CookieOptions;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(
    private readonly store: SessionStore,
    options: { secure: boolean; now?: () => number; ttlMs?: number }
  ) {
    this.cookieName = options.secure ? '__Host-session' : 'session';
    this.cookieOptions = { httpOnly: true, secure: options.secure, sameSite: 'lax', path: '/' };
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  }

  // The user of the session in this Cookie header. Undefined without a cookie, for an unknown
  // or expired session and for a blocked user.
  authenticate(cookieHeader: string | undefined): SessionUser | undefined {
    const token = readCookie(cookieHeader, this.cookieName);
    if (!token || !TOKEN_PATTERN.test(token)) return undefined;
    const tokenHash = hashToken(token);
    const now = this.now();
    const row = this.store.findSession(tokenHash, now);
    if (!row || row.email === null || row.banned_at !== null) return undefined;
    if (now - row.session_last_seen_at >= TOUCH_EVERY_MS) this.store.touchSession(tokenHash, now);
    return { id: row.id, email: row.email, role: row.role, tokenHash };
  }

  // Signs the browser in: a new session and its cookie.
  start(res: Response, userId: number): void {
    const token = newToken();
    const now = this.now();
    this.store.createSession(hashToken(token), userId, now + this.ttlMs, now);
    res.cookie(this.cookieName, token, { ...this.cookieOptions, maxAge: this.ttlMs });
  }

  // Signs the browser out: deletes the session of this Cookie header, if any, and the cookie.
  // Returns the hash of the token of the session that ended.
  end(cookieHeader: string | undefined, res: Response): string | undefined {
    const token = readCookie(cookieHeader, this.cookieName);
    res.clearCookie(this.cookieName, this.cookieOptions);
    if (!token || !TOKEN_PATTERN.test(token)) return undefined;
    const tokenHash = hashToken(token);
    return this.store.deleteSession(tokenHash) ? tokenHash : undefined;
  }
}

// The sessions of a server at publicUrl: https turns on the Secure cookie. One object is
// shared by the account routes, the check in front of the other routes and the live server.
export function createSessions(options: {
  store: SessionStore;
  publicUrl: string;
  now?: () => number;
}): Sessions {
  return new Sessions(options.store, {
    secure: options.publicUrl.startsWith('https://'),
    now: options.now,
  });
}
