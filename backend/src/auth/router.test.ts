import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS_DIR, MifDb, loadMigrations, migrate } from '@mifplace/db';
import { createApp } from '../app.js';
import { HourlyQuota } from '../email-budget.js';
import { ConsoleMailer, type Mail, type Mailer } from '../mailer.js';
import type { RateLimits } from '../rate-limits.js';
import { HasherBusyError, PasswordHasher } from './password.js';
import type { AuthOptions } from './router.js';
import { SESSION_TTL_MS } from './sessions.js';
import { hashToken } from './tokens.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const EMAIL = 'jonas@mif.stud.vu.lt';
const PASSWORD = 'correct horse battery';

let server: Server | undefined;
let mif: MifDb | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
  mif?.close();
  mif = undefined;
});

type Json = { success: boolean; error?: string; code?: string; user?: unknown };

interface Answer {
  status: number;
  body: Json;
  headers: Headers;
  // "name=value" of the session cookie this answer set, undefined if it set none; an empty
  // value means the cookie was deleted
  cookie: string | undefined;
}

interface Setup {
  mailer: ConsoleMailer;
  db: MifDb;
  raw: Database.Database;
  clock: { now: number };
  post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Answer>;
  get(path: string, headers?: Record<string, string>): Promise<Answer>;
  // Registers, verifies and signs in; returns the session cookie
  signUp(email?: string, password?: string): Promise<string>;
}

// The token of the link in an email
function tokenOf(mail: Mail | undefined, action: 'verify' | 'reset'): string {
  const match = mail?.text.match(new RegExp(`/#/${action}/([A-Za-z0-9_-]{43})`));
  assert.ok(match, `no ${action} link in the email`);
  return match[1]!;
}

// A real MifDb on an in-memory database, a ConsoleMailer that keeps the emails, a clock the
// test moves by hand and a hasher with cheap parameters.
async function start(
  options: Partial<AuthOptions> = {},
  mailer: Mailer = new ConsoleMailer(() => {}),
  rateLimits: Partial<RateLimits> = {}
): Promise<Setup> {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  migrate(raw, loadMigrations(MIGRATIONS_DIR));
  mif = new MifDb(raw);
  const clock = { now: 1_000_000_000_000 };
  const app = createApp({
    canvasSize: { width: 4, height: 4 },
    palette: [{ id: 0, color: '#000000' }],
    checkDbHealth: () => {},
    getCanvasState: () => ({ pixels: [], eventId: 0, timestamp: 0 }),
    appendEvent: () => 1,
    rateLimits,
    auth: {
      store: mif,
      mailer,
      publicUrl: 'http://localhost:3000/',
      emailDomains: ['vu.lt'],
      hasher: new PasswordHasher({ memoryKiB: 8, passes: 1, parallelism: 1 }),
      now: () => clock.now,
      ...options,
    },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server!.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/auth`;

  async function answer(res: Response): Promise<Answer> {
    // A body that is not JSON fails in express.json(), which answers with an HTML page
    const json = res.headers.get('content-type')?.includes('json');
    const body = json ? ((await res.json()) as Json) : { success: false };
    const cookie = res.headers.getSetCookie()[0]?.split(';')[0];
    return { status: res.status, body, headers: res.headers, cookie };
  }
  const post: Setup['post'] = async (path, body, headers = {}) =>
    answer(
      await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    );
  const get: Setup['get'] = async (path, headers = {}) =>
    answer(await fetch(`${base}${path}`, { headers }));

  const sent = mailer as ConsoleMailer;
  async function signUp(email = EMAIL, password = PASSWORD): Promise<string> {
    assert.equal((await post('/register', { email, password })).status, 202);
    const token = tokenOf(sent.sent[sent.sent.length - 1], 'verify');
    assert.equal((await post('/verify', { token })).status, 200);
    const login = await post('/login', { email, password });
    assert.equal(login.status, 200);
    assert.ok(login.cookie);
    return login.cookie;
  }

  return { mailer: sent, db: mif, raw, clock, post, get, signUp };
}

describe('registration and sign-in', () => {
  it('registers, verifies by the link, signs in, tells who is signed in and signs out', async () => {
    const { post, get, mailer, db } = await start();

    const registered = await post('/register', {
      email: ` ${EMAIL.toUpperCase()} `,
      password: PASSWORD,
    });
    assert.equal(registered.status, 202);
    assert.deepEqual(registered.body, { success: true });
    assert.equal(registered.cookie, undefined);
    assert.equal(registered.headers.get('cache-control'), 'no-store');
    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0]!.to, EMAIL);
    // The password is stored only as a hash
    const stored = db.findUserByEmail(EMAIL);
    assert.match(stored?.password_hash ?? '', /^\$argon2id\$v=19\$m=8,t=1,p=1\$/);
    assert.equal(stored?.verified_at, null);

    // Verifying does not sign in
    const token = tokenOf(mailer.sent[0], 'verify');
    const verified = await post('/verify', { token });
    assert.equal(verified.status, 200);
    assert.equal(verified.cookie, undefined);
    // The link works once
    const again = await post('/verify', { token });
    assert.equal(again.status, 404);
    assert.equal(again.body.code, 'invalid_token');

    const login = await post('/login', { email: EMAIL, password: PASSWORD });
    assert.equal(login.status, 200);
    assert.deepEqual(login.body, { success: true, user: { email: EMAIL, role: 'user' } });
    const cookie = login.cookie!;
    assert.match(cookie, /^session=[A-Za-z0-9_-]{43}$/);

    const me = await get('/me', { Cookie: cookie });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body, { success: true, user: { email: EMAIL, role: 'user' } });

    const out = await post('/logout', undefined, { Cookie: cookie });
    assert.equal(out.status, 200);
    assert.equal(out.cookie, 'session=');
    const after = await get('/me', { Cookie: cookie });
    assert.equal(after.status, 401);
    assert.equal(after.body.code, 'unauthenticated');
    // Signing out twice, or without a session, is fine
    assert.equal((await post('/logout')).status, 200);
  });

  it('sets a cookie scripts cannot read, Secure and __Host- over https', async () => {
    const http = await start();
    await http.signUp();
    const plain = (await http.post('/login', { email: EMAIL, password: PASSWORD })).headers
      .getSetCookie()[0]!
      .split('; ');
    assert.ok(plain.includes('HttpOnly'));
    assert.ok(plain.includes('SameSite=Lax'));
    assert.ok(plain.includes('Path=/'));
    assert.ok(plain.includes(`Max-Age=${SESSION_TTL_MS / 1000}`));
    assert.ok(!plain.includes('Secure'));
    server?.close();
    mif?.close();

    const https = await start({ publicUrl: 'https://vu.place' });
    const cookie = await https.signUp();
    assert.match(cookie, /^__Host-session=/);
    const secure = (await https.post('/login', { email: EMAIL, password: PASSWORD })).headers
      .getSetCookie()[0]!
      .split('; ');
    assert.ok(secure.includes('Secure'));
    assert.equal((await https.get('/me', { Cookie: cookie })).status, 200);
  });

  it('rejects addresses outside the allowed domains, "+" addresses and short passwords', async () => {
    const { post, mailer } = await start({ emailDomains: ['vu.lt', 'example.org'] });

    const other = await post('/register', { email: 'a@gmail.com', password: PASSWORD });
    assert.equal(other.status, 400);
    assert.equal(other.body.code, 'email_not_allowed');
    assert.match(other.body.error ?? '', /vu\.lt, example\.org/);

    const plus = await post('/register', { email: 'jonas+2@vu.lt', password: PASSWORD });
    assert.equal(plus.status, 400);
    assert.equal(plus.body.code, 'email_not_allowed');

    const short = await post('/register', { email: EMAIL, password: 'too short' });
    assert.equal(short.status, 400);
    assert.equal(short.body.code, 'invalid_request');
    assert.match(short.body.error ?? '', /at least 10/);

    assert.equal((await post('/register', {})).status, 400);
    assert.equal((await post('/register', 'text')).status, 400);
    assert.equal(mailer.sent.length, 0);

    // The second configured domain may register
    assert.equal(
      (await post('/register', { email: 'a@example.org', password: PASSWORD })).status,
      202
    );
    assert.equal(mailer.sent.length, 1);
  });

  it('answers the same for an address that has an account and tells its owner by email', async () => {
    const { post, signUp, mailer, db, clock } = await start();
    await signUp();
    clock.now += 2 * MINUTE;

    const again = await post('/register', { email: EMAIL, password: 'another password' });
    assert.equal(again.status, 202);
    assert.deepEqual(again.body, { success: true });
    assert.equal(mailer.sent.length, 2);
    assert.match(mailer.sent[1]!.subject, /already have/);
    assert.doesNotMatch(mailer.sent[1]!.text, /#\/verify/);
    // Nothing changed: the old password still signs in
    assert.equal((await post('/login', { email: EMAIL, password: PASSWORD })).status, 200);
    assert.ok(db.findUserByEmail(EMAIL)?.verified_at);
  });

  it('a repeated registration before verifying replaces the password, but not within a minute', async () => {
    const { post, mailer, clock } = await start();
    await post('/register', { email: EMAIL, password: PASSWORD });
    const first = tokenOf(mailer.sent[0], 'verify');

    // Right away: ignored, no email, the first link still works
    assert.equal(
      (await post('/register', { email: EMAIL, password: 'second password' })).status,
      202
    );
    assert.equal(mailer.sent.length, 1);

    clock.now += MINUTE;
    assert.equal(
      (await post('/register', { email: EMAIL, password: 'third password' })).status,
      202
    );
    assert.equal(mailer.sent.length, 2);
    // Only the link of the last registration works, and its password
    assert.equal((await post('/verify', { token: first })).status, 404);
    assert.equal((await post('/verify', { token: tokenOf(mailer.sent[1], 'verify') })).status, 200);
    assert.equal((await post('/login', { email: EMAIL, password: PASSWORD })).status, 401);
    assert.equal((await post('/login', { email: EMAIL, password: 'third password' })).status, 200);
  });

  it('does not sign in before the address is verified and sends the link again', async () => {
    const { post, mailer, clock } = await start();
    await post('/register', { email: EMAIL, password: PASSWORD });

    // Within a minute of the first email: refused, no second email
    const early = await post('/login', { email: EMAIL, password: PASSWORD });
    assert.equal(early.status, 403);
    assert.equal(early.body.code, 'email_not_verified');
    assert.equal(early.cookie, undefined);
    assert.equal(mailer.sent.length, 1);

    clock.now += MINUTE;
    assert.equal((await post('/login', { email: EMAIL, password: PASSWORD })).status, 403);
    assert.equal(mailer.sent.length, 2);
    // A wrong password does not send anything
    clock.now += MINUTE;
    assert.equal((await post('/login', { email: EMAIL, password: 'wrong password' })).status, 401);
    assert.equal(mailer.sent.length, 2);

    assert.equal((await post('/verify', { token: tokenOf(mailer.sent[1], 'verify') })).status, 200);
    assert.equal((await post('/login', { email: EMAIL, password: PASSWORD })).status, 200);
  });

  it('answers the same for an unknown address and a wrong password', async () => {
    const { post, signUp } = await start();
    await signUp();
    const wrong = await post('/login', { email: EMAIL, password: 'wrong password' });
    const unknown = await post('/login', { email: 'nobody@vu.lt', password: PASSWORD });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
    assert.equal(wrong.body.code, 'invalid_credentials');
    assert.equal(wrong.cookie, undefined);
    // User 0 of the seed scripts has no address and no password
    assert.equal((await post('/login', { email: '', password: PASSWORD })).status, 400);
  });

  it('stops checking after 5 wrong passwords for 15 minutes, the right one included', async () => {
    const { post, signUp, clock } = await start();
    await signUp();
    for (let i = 0; i < 5; i++) {
      assert.equal(
        (await post('/login', { email: EMAIL, password: 'wrong password' })).status,
        401
      );
    }
    const blocked = await post('/login', { email: EMAIL, password: PASSWORD });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.code, 'too_many_attempts');
    // Another account is not affected
    assert.equal((await post('/login', { email: 'ona@vu.lt', password: PASSWORD })).status, 401);

    clock.now += 15 * MINUTE;
    assert.equal((await post('/login', { email: EMAIL, password: PASSWORD })).status, 200);
  });

  it('counts wrong passwords sent at once, and a right one does not use up the limit', async () => {
    const { post, signUp } = await start();
    await signUp();
    // Signing in correctly many times is not a failure
    for (let i = 0; i < 6; i++) {
      assert.equal((await post('/login', { email: EMAIL, password: PASSWORD })).status, 200);
    }
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => post('/login', { email: EMAIL, password: 'wrong password' }))
    );
    const statuses = answers.map((a) => a.status).sort();
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429, 429, 429, 429, 429]);
  });

  it('a blocked user cannot sign in and loses the open sessions', async () => {
    const { post, get, signUp, raw, clock } = await start();
    const cookie = await signUp();
    raw.prepare('UPDATE users SET banned_at = ? WHERE email = ?').run(clock.now, EMAIL);

    assert.equal((await get('/me', { Cookie: cookie })).status, 401);
    const login = await post('/login', { email: EMAIL, password: PASSWORD });
    assert.equal(login.status, 403);
    assert.equal(login.body.code, 'banned');
    assert.equal(login.cookie, undefined);
  });

  it('a session ends after 90 days, and a made-up cookie is not one', async () => {
    const { get, signUp, clock, db } = await start();
    const cookie = await signUp();
    clock.now += SESSION_TTL_MS - HOUR;
    assert.equal((await get('/me', { Cookie: cookie })).status, 200);
    // Seen again, written to the database
    const row = db.findSession(hashToken(cookie.split('=')[1]!), clock.now);
    assert.equal(row?.session_last_seen_at, clock.now);
    clock.now += HOUR;
    assert.equal((await get('/me', { Cookie: cookie })).status, 401);

    assert.equal((await get('/me', { Cookie: `session=${'A'.repeat(43)}` })).status, 401);
    assert.equal((await get('/me', { Cookie: 'session=short' })).status, 401);
    assert.equal((await get('/me')).status, 401);
  });
});

describe('passwords', () => {
  it('forgot + reset: a new password by email, old sessions closed, the link works once', async () => {
    const { post, get, signUp, mailer, clock } = await start();
    const cookie = await signUp();
    clock.now += 2 * MINUTE;

    const forgot = await post('/password/forgot', { email: EMAIL });
    assert.equal(forgot.status, 202);
    assert.equal(mailer.sent.length, 2);
    const token = tokenOf(mailer.sent[1], 'reset');

    const short = await post('/password/reset', { token, password: 'short' });
    assert.equal(short.status, 400);

    const reset = await post('/password/reset', { token, password: 'a brand new password' });
    assert.equal(reset.status, 200);
    assert.equal(reset.cookie, undefined);
    assert.equal((await get('/me', { Cookie: cookie })).status, 401);
    assert.equal((await post('/login', { email: EMAIL, password: PASSWORD })).status, 401);
    assert.equal(
      (await post('/login', { email: EMAIL, password: 'a brand new password' })).status,
      200
    );

    const again = await post('/password/reset', { token, password: 'yet another password' });
    assert.equal(again.status, 404);
    assert.equal(again.body.code, 'invalid_token');
  });

  it('forgot answers 202 for an unknown address and sends nothing', async () => {
    const { post, mailer } = await start();
    const res = await post('/password/forgot', { email: 'nobody@vu.lt' });
    assert.equal(res.status, 202);
    assert.deepEqual(res.body, { success: true });
    assert.equal(mailer.sent.length, 0);
    assert.equal((await post('/password/forgot', { email: 'not an address' })).status, 400);
  });

  it('a reset link expires after an hour and a verify link is not a reset link', async () => {
    const { post, signUp, mailer, clock } = await start();
    await post('/register', { email: 'ona@vu.lt', password: PASSWORD });
    const verify = tokenOf(mailer.sent[0], 'verify');
    assert.equal(
      (await post('/password/reset', { token: verify, password: PASSWORD })).status,
      404
    );

    await signUp();
    clock.now += 2 * MINUTE;
    await post('/password/forgot', { email: EMAIL });
    const token = tokenOf(mailer.sent[mailer.sent.length - 1], 'reset');
    clock.now += HOUR;
    assert.equal(
      (await post('/password/reset', { token, password: 'a brand new password' })).status,
      404
    );
  });

  it('a reset verifies an account that never opened its first link', async () => {
    const { post, mailer, clock } = await start();
    await post('/register', { email: EMAIL, password: PASSWORD });
    clock.now += 2 * MINUTE;
    await post('/password/forgot', { email: EMAIL });
    const token = tokenOf(mailer.sent[1], 'reset');
    assert.equal(
      (await post('/password/reset', { token, password: 'a brand new password' })).status,
      200
    );
    assert.equal(
      (await post('/login', { email: EMAIL, password: 'a brand new password' })).status,
      200
    );
  });

  it('a blocked account gets no reset email', async () => {
    const { post, signUp, mailer, raw, clock } = await start();
    await signUp();
    raw.prepare('UPDATE users SET banned_at = 1 WHERE email = ?').run(EMAIL);
    clock.now += 2 * MINUTE;
    assert.equal((await post('/password/forgot', { email: EMAIL })).status, 202);
    assert.equal(mailer.sent.length, 1);
    // Nor an "already registered" one
    assert.equal((await post('/register', { email: EMAIL, password: PASSWORD })).status, 202);
    assert.equal(mailer.sent.length, 1);
  });

  it('change: needs the session and the current password, signs the other browsers out', async () => {
    const { post, get, signUp } = await start();
    const cookie = await signUp();
    const other = (await post('/login', { email: EMAIL, password: PASSWORD })).cookie!;
    const body = { currentPassword: PASSWORD, newPassword: 'a brand new password' };

    const anonymous = await post('/password/change', body);
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.code, 'unauthenticated');

    const wrong = await post(
      '/password/change',
      { ...body, currentPassword: 'wrong password' },
      { Cookie: cookie }
    );
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, 'invalid_credentials');

    assert.equal(
      (await post('/password/change', { currentPassword: PASSWORD }, { Cookie: cookie })).status,
      400
    );

    assert.equal((await post('/password/change', body, { Cookie: cookie })).status, 200);
    assert.equal((await get('/me', { Cookie: cookie })).status, 200);
    assert.equal((await get('/me', { Cookie: other })).status, 401);
    assert.equal((await post('/login', { email: EMAIL, password: PASSWORD })).status, 401);
    assert.equal(
      (await post('/login', { email: EMAIL, password: 'a brand new password' })).status,
      200
    );
  });
});

describe('protection', () => {
  it('refuses a POST from another site, allows the own host and the configured origins', async () => {
    const { post, get } = await start({ allowedOrigins: ['http://localhost:5173'] });
    const body = { email: EMAIL, password: PASSWORD };

    const foreign = await post('/login', body, { Origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.code, 'forbidden_origin');
    assert.equal((await post('/logout', undefined, { Origin: 'null' })).status, 403);

    const own = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    assert.equal((await post('/login', body, { Origin: own })).status, 401);
    assert.equal((await post('/login', body, { Origin: 'http://localhost:5173' })).status, 401);
    // Reading is not refused: it changes nothing
    assert.equal((await get('/me', { Origin: 'https://evil.example' })).status, 401);
  });

  it('answers 503 when the email cannot be sent, and a retry right away works', async () => {
    let failing = true;
    const sent: Mail[] = [];
    const flaky: Mailer = {
      send: (mail) => {
        if (failing) return Promise.reject(new Error('SMTP down'));
        sent.push(mail);
        return Promise.resolve();
      },
    };
    const { post } = await start({}, flaky);
    const res = await post('/register', { email: EMAIL, password: PASSWORD });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'mail_unavailable');
    failing = false;
    assert.equal((await post('/register', { email: EMAIL, password: PASSWORD })).status, 202);
    assert.equal(sent.length, 1);
  });

  it('answers 503 when the hourly quota of all emails is used up', async () => {
    const quota = new HourlyQuota(1);
    const { post, mailer, clock } = await start({ quota });
    assert.equal((await post('/register', { email: EMAIL, password: PASSWORD })).status, 202);

    const register = await post('/register', { email: 'ona@vu.lt', password: PASSWORD });
    assert.equal(register.status, 503);
    assert.equal(register.body.code, 'mail_unavailable');
    // The same for an address with and without an account
    assert.equal((await post('/password/forgot', { email: 'ona@vu.lt' })).status, 503);
    assert.equal((await post('/password/forgot', { email: 'nobody@vu.lt' })).status, 503);
    assert.equal(mailer.sent.length, 1);

    clock.now += HOUR;
    assert.equal((await post('/register', { email: 'ona@vu.lt', password: PASSWORD })).status, 202);
  });

  it('one address gets at most five emails a day', async () => {
    const { post, mailer, clock } = await start();
    for (let i = 0; i < 7; i++) {
      assert.equal((await post('/register', { email: EMAIL, password: PASSWORD })).status, 202);
      clock.now += 2 * MINUTE;
    }
    assert.equal(mailer.sent.length, 5);
    clock.now += DAY;
    await post('/register', { email: EMAIL, password: PASSWORD });
    assert.equal(mailer.sent.length, 6);
  });

  it('answers 503 when too many passwords wait to be hashed, 500 when the database fails', async () => {
    class Busy extends PasswordHasher {
      override hash(): Promise<string> {
        return Promise.reject(new HasherBusyError());
      }
    }
    const busy = await start({ hasher: new Busy() });
    const res = await busy.post('/register', { email: EMAIL, password: PASSWORD });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'busy');
    server?.close();
    mif?.close();

    const broken = await start();
    broken.raw.exec('DROP TABLE sessions; DROP TABLE email_tokens; DROP TABLE users');
    const failed = await broken.post('/login', { email: EMAIL, password: PASSWORD });
    assert.equal(failed.status, 500);
    assert.deepEqual(failed.body, {
      success: false,
      code: 'internal',
      error: 'Internal server error',
    });
  });

  it('limits requests per IP for every route on its own', async () => {
    const { post, get } = await start({}, undefined, {
      authRegisterPerHour: 1,
      authLoginPerMinute: 1,
      authPasswordPerHour: 1,
      authPerMinute: 1,
    });
    const body = { email: EMAIL, password: PASSWORD };
    assert.equal((await post('/register', body)).status, 202);
    assert.equal((await post('/register', body)).status, 429);
    assert.equal((await post('/login', body)).status, 403);
    assert.equal((await post('/login', body)).status, 429);
    assert.equal((await post('/password/forgot', { email: EMAIL })).status, 202);
    assert.equal((await post('/password/forgot', { email: EMAIL })).status, 429);
    // /reset and /change count on their own
    assert.equal((await post('/password/reset', {})).status, 400);
    assert.equal((await post('/password/change', {})).status, 401);
    assert.equal((await get('/me')).status, 401);
    assert.equal((await get('/me')).status, 429);
    assert.equal((await post('/logout')).status, 200);
  });

  it('has no routes when the accounts are off', async () => {
    const app = createApp({
      canvasSize: { width: 4, height: 4 },
      palette: [{ id: 0, color: '#000000' }],
      checkDbHealth: () => {},
      getCanvasState: () => ({ pixels: [], eventId: 0, timestamp: 0 }),
      appendEvent: () => 1,
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server!.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
    assert.equal(res.status, 404);
  });
});
