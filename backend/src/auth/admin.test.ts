import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS_DIR, MifDb, loadMigrations, migrate } from '@mifplace/db';
import { createApp } from '../app.js';
import { ConsoleMailer } from '../mailer.js';
import { adminEmailsFromEnv } from './config.js';
import { PasswordHasher } from './password.js';
import type { AuthOptions } from './router.js';
import type { SessionsEnded } from './sessions.js';

// The admin routes and the deletion of an account, on the whole app with a real database.

const ADMIN = 'admin@mif.vu.lt';
const USER = 'jonas@mif.stud.vu.lt';
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

type Account = {
  id: number;
  email: string;
  role: string;
  bannedAt: number | null;
  banReason: string | null;
  sessions: number;
};
type Json = {
  success?: boolean;
  code?: string;
  error?: string;
  user?: Account;
  users?: Account[];
};

async function start(options: Partial<AuthOptions> = {}) {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  migrate(raw, loadMigrations(MIGRATIONS_DIR));
  const db = (mif = new MifDb(raw));
  const mailer = new ConsoleMailer(() => {});
  const clock = { now: 1_000_000_000_000 };
  const ended: SessionsEnded[] = [];
  const app = createApp({
    canvasSize: { width: 4, height: 4 },
    palette: [{ id: 0, color: '#000000' }],
    checkDbHealth: () => {},
    getCanvasState: () => ({ pixels: [], eventId: 0, timestamp: 0 }),
    appendEvent: () => 1,
    auth: {
      store: db,
      mailer,
      publicUrl: 'http://localhost:3000',
      emailDomains: ['vu.lt'],
      adminEmails: [ADMIN],
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
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    { cookie, body }: { cookie?: string; body?: unknown } = {}
  ) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
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

  const signIn = async (email: string, password = PASSWORD) =>
    call('POST', '/api/auth/login', { body: { email, password } });

  // Registers, verifies and signs in; returns the session cookie
  async function signUp(email: string): Promise<string> {
    const body = { email, password: PASSWORD };
    assert.equal((await call('POST', '/api/auth/register', { body })).status, 202);
    const token = mailer.sent[mailer.sent.length - 1]!.text.match(/#\/verify\/([\w-]{43})/)![1];
    assert.equal((await call('POST', '/api/auth/verify', { body: { token } })).status, 200);
    const login = await signIn(email);
    assert.ok(login.cookie, `sign-in of ${email}`);
    return login.cookie;
  }

  const idOf = (email: string) => db.findUserByEmail(email)!.id;

  return { call, signIn, signUp, idOf, ended, raw, db, clock, mailer };
}

describe('who may use the admin routes', () => {
  it('lets in only a signed-in administrator', async () => {
    const { call, signUp, idOf } = await start();
    const admin = await signUp(ADMIN);
    const user = await signUp(USER);
    const id = idOf(USER);
    const routes = [
      ['GET', '/api/admin/users?query=jonas'],
      ['POST', `/api/admin/users/${id}/block`],
      ['POST', `/api/admin/users/${id}/unblock`],
      ['POST', `/api/admin/users/${id}/sessions/end`],
    ] as const;

    for (const [method, path] of routes) {
      const anonymous = await call(method, path);
      assert.equal(anonymous.status, 401, path);
      const plain = await call(method, path, {
        cookie: user,
        body: method === 'POST' ? { reason: 'x' } : undefined,
      });
      assert.equal(plain.status, 403, path);
      assert.equal(plain.body.code, 'forbidden');
    }
    assert.equal(
      (await call('GET', '/api/admin/users?query=jonas', { cookie: admin })).status,
      200
    );
    // The page learns the role from /me
    assert.equal((await call('GET', '/api/auth/me', { cookie: admin })).body.user?.role, 'admin');
    assert.equal((await call('GET', '/api/auth/me', { cookie: user })).body.user?.role, 'user');
  });

  it('makes an address from ADMIN_EMAILS an administrator once it is verified, not before', async () => {
    const { call, signUp, db, mailer } = await start();
    await call('POST', '/api/auth/register', { body: { email: ADMIN, password: PASSWORD } });
    assert.equal(db.findUserByEmail(ADMIN)?.role, 'user');
    const token = mailer.sent[0]!.text.match(/#\/verify\/([\w-]{43})/)![1];
    await call('POST', '/api/auth/verify', { body: { token } });
    assert.equal(db.findUserByEmail(ADMIN)?.role, 'admin');
    // Nobody else gets the role by registering
    await signUp(USER);
    assert.equal(db.findUserByEmail(USER)?.role, 'user');
  });

  it('stops at once when the role is taken away', async () => {
    const { call, signUp, db } = await start();
    const admin = await signUp(ADMIN);
    assert.equal((await call('GET', '/api/admin/users?query=a', { cookie: admin })).status, 200);
    // What the server does at its next start without the address in ADMIN_EMAILS
    assert.deepEqual(db.syncAdmins([]), { demoted: 1, promoted: 0 });
    assert.equal((await call('GET', '/api/admin/users?query=a', { cookie: admin })).status, 403);
  });
});

describe('admin routes', () => {
  it('finds accounts by a part of the address', async () => {
    const { call, signUp, signIn } = await start();
    const admin = await signUp(ADMIN);
    await signUp(USER);
    await signIn(USER);
    await signUp('jonas_2@vu.lt');

    const found = await call('GET', '/api/admin/users?query=%20JONAS%20', { cookie: admin });
    assert.equal(found.status, 200);
    assert.deepEqual(
      found.body.users?.map((u) => [u.email, u.role, u.sessions, u.bannedAt]),
      [
        [USER, 'user', 2, null],
        ['jonas_2@vu.lt', 'user', 1, null],
      ]
    );
    // "_" and "%" are letters, not wildcards
    const exact = await call('GET', '/api/admin/users?query=jonas_', { cookie: admin });
    assert.deepEqual(
      exact.body.users?.map((u) => u.email),
      ['jonas_2@vu.lt']
    );
    assert.deepEqual(
      (await call('GET', '/api/admin/users?query=%25', { cookie: admin })).body.users,
      []
    );
    assert.equal((await call('GET', '/api/admin/users', { cookie: admin })).status, 400);
    assert.equal((await call('GET', '/api/admin/users?query=', { cookie: admin })).status, 400);
  });

  it('blocks an account: its sessions end, it cannot sign in, and unblocking brings it back', async () => {
    const { call, signUp, signIn, idOf, ended, db } = await start();
    const admin = await signUp(ADMIN);
    const user = await signUp(USER);
    const id = idOf(USER);
    assert.equal((await call('GET', '/api/canvas', { cookie: user })).status, 200);

    const noReason = await call('POST', `/api/admin/users/${id}/block`, {
      cookie: admin,
      body: {},
    });
    assert.equal(noReason.status, 400);

    const blocked = await call('POST', `/api/admin/users/${id}/block`, {
      cookie: admin,
      body: { reason: ' Drew over the faculty logo ' },
    });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.user?.email, USER);
    assert.ok(blocked.body.user?.bannedAt);
    assert.equal(blocked.body.user?.banReason, 'Drew over the faculty logo');
    assert.equal(blocked.body.user?.sessions, 0);
    // The live connections of the user are told to close
    assert.deepEqual(ended, [{ userId: id }]);

    assert.equal((await call('GET', '/api/canvas', { cookie: user })).status, 401);
    const refused = await signIn(USER);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'banned');

    const unblocked = await call('POST', `/api/admin/users/${id}/unblock`, { cookie: admin });
    assert.equal(unblocked.status, 200);
    assert.equal(unblocked.body.user?.bannedAt, null);
    assert.equal((await signIn(USER)).status, 200);

    const adminId = idOf(ADMIN);
    assert.deepEqual(
      db.getAdminLog(10).map((row) => [row.admin_id, row.action, row.target_user_id, row.details]),
      [
        [adminId, 'unblock', id, null],
        [adminId, 'block', id, 'Drew over the faculty logo'],
      ]
    );
  });

  it('signs every browser of an account out', async () => {
    const { call, signUp, signIn, idOf, ended, db } = await start();
    const admin = await signUp(ADMIN);
    const first = await signUp(USER);
    const second = (await signIn(USER)).cookie!;
    const id = idOf(USER);

    const res = await call('POST', `/api/admin/users/${id}/sessions/end`, { cookie: admin });
    assert.equal(res.status, 200);
    assert.equal(res.body.user?.sessions, 0);
    assert.deepEqual(ended, [{ userId: id }]);
    assert.equal((await call('GET', '/api/canvas', { cookie: first })).status, 401);
    assert.equal((await call('GET', '/api/canvas', { cookie: second })).status, 401);
    // Not a block: the owner signs in again
    assert.equal((await signIn(USER)).status, 200);
    assert.equal(db.getAdminLog(1)[0]?.action, 'end_sessions');
  });

  it('refuses to block an administrator and answers 404 for what is not an account', async () => {
    const { call, signUp, idOf, db } = await start();
    const admin = await signUp(ADMIN);
    const self = await call('POST', `/api/admin/users/${idOf(ADMIN)}/block`, {
      cookie: admin,
      body: { reason: 'oops' },
    });
    assert.equal(self.status, 400);
    assert.match(self.body.error ?? '', /ADMIN_EMAILS/);
    assert.equal((await call('GET', '/api/auth/me', { cookie: admin })).status, 200);

    // User 0 of the seed scripts, an unknown id, something that is not an id
    for (const id of ['0', '999', 'abc', '1e3']) {
      for (const action of ['block', 'unblock', 'sessions/end']) {
        const res = await call('POST', `/api/admin/users/${id}/${action}`, {
          cookie: admin,
          body: { reason: 'x' },
        });
        assert.equal(res.status, 404, `${id} ${action}`);
        assert.equal(res.body.code, 'not_found');
      }
    }
    assert.equal(db.getAdminLog(10).length, 0);
  });
});

describe('deleting an account', () => {
  it('needs the session and the password', async () => {
    const { call, signUp, db } = await start();
    const user = await signUp(USER);
    assert.equal(
      (await call('DELETE', '/api/auth/account', { body: { password: PASSWORD } })).status,
      401
    );
    assert.equal(
      (await call('DELETE', '/api/auth/account', { cookie: user, body: {} })).status,
      400
    );
    const wrong = await call('DELETE', '/api/auth/account', {
      cookie: user,
      body: { password: 'wrong password' },
    });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, 'invalid_credentials');
    assert.equal(db.findUserByEmail(USER)?.email, USER);
  });

  it('removes the address everywhere, keeps the pixels, and lets the address register again', async () => {
    const { call, signUp, signIn, idOf, ended, raw, db, clock } = await start();
    const first = await signUp(USER);
    const second = (await signIn(USER)).cookie!;
    const id = idOf(USER);
    db.appendEvent({ user_id: id, color_id: 0, position: 1 });
    db.addToWaitlist(USER, 'w'.repeat(43), clock.now);

    const res = await call('DELETE', '/api/auth/account', {
      cookie: first,
      body: { password: PASSWORD },
    });
    assert.equal(res.status, 200);
    assert.equal(res.cookie, 'session=');
    assert.deepEqual(ended, [{ userId: id }]);

    // Every browser is signed out and the password no longer signs in
    assert.equal((await call('GET', '/api/auth/me', { cookie: first })).status, 401);
    assert.equal((await call('GET', '/api/canvas', { cookie: second })).status, 401);
    assert.equal((await signIn(USER)).status, 401);

    // No table holds the address; the row of the user and its pixel are still there
    assert.equal(db.findUserByEmail(USER), undefined);
    const tables = ['users', 'waitlist'] as const;
    for (const table of tables) {
      const hits = raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE email = ?`).get(USER);
      assert.deepEqual(hits, { n: 0 }, table);
    }
    assert.deepEqual(
      raw
        .prepare('SELECT id, email, password_hash, verified_at, role FROM users WHERE id = ?')
        .get(id),
      { id, email: null, password_hash: null, verified_at: null, role: 'user' }
    );
    assert.equal(
      (raw.prepare('SELECT count(*) AS n FROM events WHERE user_id = ?').get(id) as { n: number })
        .n,
      1
    );
    assert.equal((raw.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n, 0);

    // The same address starts over as a new account
    clock.now += 2 * MINUTE;
    await signUp(USER);
    assert.notEqual(idOf(USER), id);
  });
});

describe('adminEmailsFromEnv', () => {
  it('reads a comma-separated list, lower-cased and without repeats', () => {
    assert.deepEqual(adminEmailsFromEnv({}), []);
    assert.deepEqual(adminEmailsFromEnv({ ADMIN_EMAILS: ' ' }), []);
    assert.deepEqual(
      adminEmailsFromEnv({ ADMIN_EMAILS: ' Admin@MIF.vu.lt, second@vu.lt ,admin@mif.vu.lt' }),
      ['admin@mif.vu.lt', 'second@vu.lt']
    );
  });

  it('stops the server at start on an entry that is not an address', () => {
    for (const value of ['admin', 'admin@vu.lt,', 'admin@vu.lt;second@vu.lt']) {
      assert.throws(
        () => adminEmailsFromEnv({ ADMIN_EMAILS: value }),
        /Invalid ADMIN_EMAILS/,
        value
      );
    }
  });
});
