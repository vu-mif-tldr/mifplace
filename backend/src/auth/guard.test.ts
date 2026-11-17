import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS_DIR, MifDb, loadMigrations, migrate, type NewEvent } from '@mifplace/db';
import { createApp } from '../app.js';
import { ConsoleMailer } from '../mailer.js';
import { PasswordHasher } from './password.js';
import type { AuthOptions } from './router.js';
import type { SessionsEnded } from './sessions.js';

// The whole app with accounts: what answers without a session, what needs one, and who a
// placed pixel belongs to.

const EMAIL = 'jonas@mif.stud.vu.lt';
const PASSWORD = 'correct horse battery';
const MINUTE = 60 * 1000;

let server: Server | undefined;
let mif: MifDb | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
  mif?.close();
  mif = undefined;
});

type Json = { success?: boolean; code?: string; error?: string; eventId?: number };

async function start(options: Partial<AuthOptions> = {}) {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  migrate(raw, loadMigrations(MIGRATIONS_DIR));
  mif = new MifDb(raw);
  const mailer = new ConsoleMailer(() => {});
  const clock = { now: 1_000_000_000_000 };
  const placed: NewEvent[] = [];
  const ended: SessionsEnded[] = [];
  const app = createApp({
    canvasSize: { width: 4, height: 4 },
    palette: [{ id: 0, color: '#000000' }],
    checkDbHealth: () => {},
    getCanvasState: () => ({ pixels: [], eventId: 0, timestamp: 0 }),
    appendEvent: (event) => placed.push(event),
    waitlist: { store: mif, mailer, publicUrl: 'http://localhost:3000' },
    auth: {
      store: mif,
      mailer,
      publicUrl: 'http://localhost:3000',
      emailDomains: ['vu.lt'],
      hasher: new PasswordHasher({ memoryKiB: 8, passes: 1, parallelism: 1 }),
      now: () => clock.now,
      onSessionsEnded: (which) => ended.push(which),
      ...options,
    },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server!.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(
    method: 'GET' | 'POST',
    path: string,
    { cookie, body, origin }: { cookie?: string; body?: unknown; origin?: string } = {}
  ) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = res.headers.get('content-type')?.includes('json');
    return {
      status: res.status,
      body: (json ? await res.json() : {}) as Json,
      cookie: res.headers.getSetCookie()[0]?.split(';')[0],
    };
  }

  // Registers, verifies and signs in; returns the session cookie
  async function signUp(email = EMAIL): Promise<string> {
    assert.equal(
      (await call('POST', '/api/auth/register', { body: { email, password: PASSWORD } })).status,
      202
    );
    const token = mailer.sent[mailer.sent.length - 1]!.text.match(/#\/verify\/([\w-]{43})/)![1];
    assert.equal((await call('POST', '/api/auth/verify', { body: { token } })).status, 200);
    const login = await call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
    assert.ok(login.cookie);
    return login.cookie;
  }

  return { call, signUp, placed, ended, mailer, raw, db: mif, clock, base };
}

const pixel = { pos: 3, colorIndex: 0 };

describe('routes without a session', () => {
  it('refuses the canvas, the palette, the size and a pixel with 401', async () => {
    const { call, placed } = await start();
    for (const path of ['/api/palette', '/api/canvas/size', '/api/canvas']) {
      const res = await call('GET', path);
      assert.equal(res.status, 401, path);
      assert.deepEqual(res.body, {
        success: false,
        code: 'unauthenticated',
        error: 'Not signed in.',
      });
    }
    const post = await call('POST', '/api/pixels', { body: pixel });
    assert.equal(post.status, 401);
    assert.equal(placed.length, 0);
    // A route that does not exist tells nothing either
    assert.equal((await call('GET', '/api/anything')).status, 401);
    // A made-up cookie is not a session
    assert.equal(
      (await call('GET', '/api/canvas', { cookie: `session=${'A'.repeat(43)}` })).status,
      401
    );
  });

  it('still answers the health check, the accounts and the waitlist', async () => {
    const { call } = await start();
    assert.equal((await call('GET', '/health')).status, 200);
    assert.equal((await call('POST', '/api/waitlist', { body: { email: 'a@vu.lt' } })).status, 202);
    assert.equal(
      (await call('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } }))
        .status,
      401
    );
    // Its own 401: asking who is signed in is allowed to everyone
    assert.equal((await call('GET', '/api/auth/me')).body.code, 'unauthenticated');
  });
});

describe('routes with a session', () => {
  it('answers the canvas routes and stores a pixel with the user who placed it', async () => {
    const { call, signUp, placed, db } = await start();
    const cookie = await signUp();
    for (const path of ['/api/palette', '/api/canvas/size', '/api/canvas']) {
      assert.equal((await call('GET', path, { cookie })).status, 200, path);
    }
    const res = await call('POST', '/api/pixels', { cookie, body: pixel });
    assert.equal(res.status, 201);
    const userId = db.findUserByEmail(EMAIL)!.id;
    assert.notEqual(userId, 0);
    assert.deepEqual(placed, [{ user_id: userId, color_id: 0, position: 3 }]);

    // Another user, another id
    const other = await signUp('ona@vu.lt');
    await call('POST', '/api/pixels', { cookie: other, body: pixel });
    assert.equal(placed[1]!.user_id, db.findUserByEmail('ona@vu.lt')!.id);
  });

  it('refuses a pixel sent from another site even with the cookie', async () => {
    const { call, signUp, placed, base } = await start({
      allowedOrigins: ['http://localhost:5173'],
    });
    const cookie = await signUp();
    const foreign = await call('POST', '/api/pixels', {
      cookie,
      body: pixel,
      origin: 'https://evil.example',
    });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.code, 'forbidden_origin');
    assert.equal(placed.length, 0);
    // Our own page and a configured origin may; reading is never refused for its origin
    assert.equal(
      (await call('POST', '/api/pixels', { cookie, body: pixel, origin: base })).status,
      201
    );
    assert.equal(
      (await call('POST', '/api/pixels', { cookie, body: pixel, origin: 'http://localhost:5173' }))
        .status,
      201
    );
    assert.equal(
      (await call('GET', '/api/canvas', { cookie, origin: 'https://evil.example' })).status,
      200
    );
  });

  it('stops at once for a blocked user, a signed-out browser and an expired session', async () => {
    const { call, signUp, raw, clock } = await start();
    const blocked = await signUp();
    raw.prepare('UPDATE users SET banned_at = 1 WHERE email = ?').run(EMAIL);
    assert.equal((await call('GET', '/api/canvas', { cookie: blocked })).status, 401);
    assert.equal((await call('POST', '/api/pixels', { cookie: blocked, body: pixel })).status, 401);

    const cookie = await signUp('ona@vu.lt');
    assert.equal((await call('GET', '/api/canvas', { cookie })).status, 200);
    await call('POST', '/api/auth/logout', { cookie });
    assert.equal((await call('GET', '/api/canvas', { cookie })).status, 401);

    const later = await signUp('petras@vu.lt');
    clock.now += 91 * 24 * 60 * MINUTE;
    assert.equal((await call('GET', '/api/canvas', { cookie: later })).status, 401);
  });
});

describe('sessions that end', () => {
  it('tells which ones: one on sign-out, all on a reset, all but one on a password change', async () => {
    const { call, signUp, ended, mailer, db, clock } = await start();
    const first = await signUp();
    const second = (
      await call('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } })
    ).cookie!;
    const userId = db.findUserByEmail(EMAIL)!.id;
    const { hashToken } = await import('./tokens.js');
    const hashOf = (cookie: string) => hashToken(cookie.split('=')[1]!);

    await call('POST', '/api/auth/logout', { cookie: second });
    assert.deepEqual(ended, [{ session: hashOf(second) }]);
    // Signing out without a session ends nothing
    await call('POST', '/api/auth/logout');
    await call('POST', '/api/auth/logout', { cookie: second });
    assert.equal(ended.length, 1);

    const body = { currentPassword: PASSWORD, newPassword: 'a brand new password' };
    assert.equal(
      (await call('POST', '/api/auth/password/change', { cookie: first, body })).status,
      200
    );
    assert.deepEqual(ended[1], { userId, exceptSession: hashOf(first) });

    clock.now += 2 * MINUTE;
    await call('POST', '/api/auth/password/forgot', { body: { email: EMAIL } });
    const token = mailer.sent[mailer.sent.length - 1]!.text.match(/#\/reset\/([\w-]{43})/)![1];
    const reset = await call('POST', '/api/auth/password/reset', {
      body: { token, password: 'yet another password' },
    });
    assert.equal(reset.status, 200);
    assert.deepEqual(ended[2], { userId });
    assert.equal(ended.length, 3);
  });
});
