import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { MifDb, openDb, resolveDbPath } from './db.js';
import { REPO_ROOT } from './env.js';
import { MIGRATIONS_DIR, loadMigrations, migrate } from './migrate.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mifplace-test-'));
}

describe('resolveDbPath', () => {
  it('resolves DB_PATH against the repository root and throws when it is not set', () => {
    const saved = process.env.DB_PATH;
    try {
      process.env.DB_PATH = '/x/y.db';
      assert.equal(resolveDbPath(), path.resolve('/x/y.db'));

      process.env.DB_PATH = './data/y.db';
      assert.equal(resolveDbPath(), path.join(REPO_ROOT, 'data', 'y.db'));

      delete process.env.DB_PATH;
      assert.throws(() => resolveDbPath(), /DB_PATH must be set/);

      process.env.DB_PATH = '';
      assert.throws(() => resolveDbPath(), /DB_PATH must be set/);
    } finally {
      if (saved === undefined) delete process.env.DB_PATH;
      else process.env.DB_PATH = saved;
    }
  });
});

describe('openDb', () => {
  it('does not create a missing file or directory', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'sub', 't.db');
    assert.throws(() => openDb(file), /Database file not found/);
    assert.equal(fs.existsSync(path.dirname(file)), false);

    fs.mkdirSync(path.dirname(file));
    new Database(file).close();
    openDb(file).close();
    fs.rmSync(dir, { recursive: true });
  });
});

describe('openDb / MifDb', () => {
  it('sets pragmas and stores events', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'sub', 't.db');
    fs.mkdirSync(path.dirname(file));
    new Database(file).close();
    const db = openDb(file);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);

    migrate(db, loadMigrations(MIGRATIONS_DIR));
    const mif = new MifDb(db);

    assert.deepEqual(mif.getCanvasSize(), { width: 128, height: 128 });
    // using a fixed 256*256 position to avoid depending on the canvas size, which is not set in this test
    // at the time of writing, there is no upper limit on the position, only a lower limit of 0, so this is
    // safe as of now
    const id = mif.appendEvent({ user_id: 0, color_id: 7, position: 256 * 256 }, 1000);
    assert.equal(mif.getLastEventId(), id);

    mif.appendEvent({ user_id: 0, color_id: 7, position: 5 }, 2000);
    mif.appendEvent({ user_id: 0, color_id: 4, position: 10 }, 3000);
    mif.appendEvent({ user_id: 0, color_id: 2, position: 5 }, 4000);

    assert.deepEqual(
      mif.getPixelHistory(5, 10).map((e) => e.color_id),
      [2, 7]
    );
    assert.deepEqual(
      mif.getPixelHistory(5, 1).map((e) => e.color_id),
      [2]
    );
    assert.deepEqual(mif.getPixelHistory(6, 10), []);

    assert.deepEqual(
      mif.getEventsAfter(id).map((e) => [e.position, e.color_id, e.timestamp]),
      [
        [5, 7, 2000],
        [10, 4, 3000],
        [5, 2, 4000],
      ]
    );

    // Catch-up reads: ids in (afterId, toId], and the timestamp of one event
    assert.deepEqual(
      mif.getEventsBetween(id, id + 2).map((e) => [e.id, e.timestamp]),
      [
        [id + 1, 2000],
        [id + 2, 3000],
      ]
    );
    assert.deepEqual(mif.getEventsBetween(id + 3, id + 3), []);
    assert.equal(mif.getEventTimestamp(id + 2), 3000);
    assert.equal(mif.getEventTimestamp(id + 99), undefined);

    assert.throws(() => mif.appendEvent({ user_id: -1, color_id: 7, position: 256 * 256 }, 1000));
    assert.throws(() => mif.appendEvent({ user_id: 0, color_id: -1, position: 256 * 256 }, 1000));
    assert.throws(() => mif.appendEvent({ user_id: 0, color_id: 7, position: -1 }, 1000));

    mif.close();
    fs.rmSync(dir, { recursive: true });
  });

  it('returns the palette', () => {
    const db = new Database(':memory:');
    migrate(db, loadMigrations(MIGRATIONS_DIR));
    const mifdb = new MifDb(db);

    // The order of the colors is not guaranteed, look them up by id
    const palette = mifdb.getPalette();
    assert.equal(palette.length, 16);
    assert.deepEqual(
      palette.find((c) => c.id === 0),
      { id: 0, color: '#000000' }
    );
    assert.deepEqual(
      palette.find((c) => c.id === 15),
      { id: 15, color: '#99D9EA' }
    );
    assert.deepEqual(
      palette.map(({ id }) => id).sort((a, b) => a - b),
      Array.from({ length: 16 }, (_, i) => i)
    );

    mifdb.close();
  });

  it('keeps only one positive integer canvas size', () => {
    const db = new Database(':memory:');
    migrate(db, loadMigrations(MIGRATIONS_DIR));
    const update = db.prepare('UPDATE canvas SET width = ?, height = ?');

    for (const [width, height] of [
      [0, 128],
      [128, 0],
      [-128, -128],
      [1.5, 128],
      ['abc', 128],
    ]) {
      assert.throws(() => update.run(width, height), `${width}x${height}`);
    }
    assert.throws(() => db.prepare('INSERT INTO canvas (width, height) VALUES (64, 64)').run());

    update.run(256, 64);
    assert.deepEqual(new MifDb(db).getCanvasSize(), { width: 256, height: 64 });
    db.close();
  });

  it('keeps palette color ids unique and non-negative', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, loadMigrations(MIGRATIONS_DIR));
    const insert = db.prepare('INSERT INTO palette (color_id, text) VALUES (?, ?)');

    assert.throws(() => insert.run(-1, '#123456'), /CHECK constraint failed/);
    assert.throws(() => insert.run(0, '#123456'), /UNIQUE constraint failed/);
    assert.throws(() => insert.run('abc', '#123456'));

    // Without an id the next free one is taken, events can still reference palette
    const id = Number(
      db.prepare("INSERT INTO palette (text) VALUES ('#123456')").run().lastInsertRowid
    );
    assert.equal(id, 16);
    const mif = new MifDb(db);
    mif.appendEvent({ user_id: 0, color_id: id, position: 0 }, 1000);
    assert.throws(() => mif.appendEvent({ user_id: 0, color_id: 99, position: 0 }, 1000));
    mif.close();
  });
});

describe('MifDb waitlist', () => {
  function waitlistDb(): MifDb {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, loadMigrations(MIGRATIONS_DIR));
    return new MifDb(db);
  }
  const tokenA = 'a'.repeat(43);
  const tokenB = 'b'.repeat(43);

  it('keeps the token of an address that signs up again', () => {
    const mif = waitlistDb();
    const first = mif.addToWaitlist('jonas@mif.stud.vu.lt', tokenA, 1000);
    assert.equal(first.token, tokenA);
    assert.equal(first.confirmed_at, null);

    // Pending: the token stays, the confirmation period restarts
    const again = mif.addToWaitlist('jonas@mif.stud.vu.lt', tokenB, 2000);
    assert.equal(again.token, tokenA);
    assert.equal(again.created_at, 2000);

    // Confirmed: nothing changes
    assert.equal(mif.confirmWaitlist(tokenA, 0, 3000), true);
    const confirmed = mif.addToWaitlist('jonas@mif.stud.vu.lt', tokenB, 4000);
    assert.equal(confirmed.token, tokenA);
    assert.equal(confirmed.created_at, 2000);
    assert.equal(confirmed.confirmed_at, 3000);
    mif.close();
  });

  it('confirms by token once and not after the link expires', () => {
    const mif = waitlistDb();
    mif.addToWaitlist('a@vu.lt', tokenA, 1000);
    mif.addToWaitlist('b@vu.lt', tokenB, 1000);

    assert.equal(mif.confirmWaitlist('x'.repeat(43), 0, 2000), false);
    // b was created before the cutoff: expired
    assert.equal(mif.confirmWaitlist(tokenB, 1500, 2000), false);
    assert.equal(mif.confirmWaitlist(tokenA, 1000, 2000), true);
    // A second click is fine and keeps the first time, even after the cutoff
    assert.equal(mif.confirmWaitlist(tokenA, 5000, 6000), true);
    assert.equal(mif.addToWaitlist('a@vu.lt', tokenB, 7000).confirmed_at, 2000);
    mif.close();
  });

  it('removes by token and drops expired pending rows only', () => {
    const mif = waitlistDb();
    mif.addToWaitlist('a@vu.lt', tokenA, 1000);
    mif.addToWaitlist('b@vu.lt', tokenB, 1000);
    mif.confirmWaitlist(tokenA, 0, 1100);

    assert.equal(mif.removeExpiredWaitlist(2000), 1);
    assert.equal(mif.removeFromWaitlist(tokenB), false);
    assert.equal(mif.removeFromWaitlist(tokenA), true);
    assert.equal(mif.removeFromWaitlist(tokenA), false);
    mif.close();
  });

  it('rejects addresses that are not lower case and short tokens', () => {
    const mif = waitlistDb();
    assert.throws(() => mif.addToWaitlist('Jonas@vu.lt', tokenA), /CHECK constraint failed/);
    assert.throws(() => mif.addToWaitlist('a@vu.lt', 'short'), /CHECK constraint failed/);
    mif.close();
  });
});

describe('MifDb accounts', () => {
  function accountsDb(): { mif: MifDb; db: Database.Database } {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, loadMigrations(MIGRATIONS_DIR));
    return { mif: new MifDb(db), db };
  }
  const hash = (c: string) => c.repeat(64);
  const DAY = 24 * 60 * 60 * 1000;

  it('migration 007 keeps the old users as system users and their events', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const migrations = loadMigrations(MIGRATIONS_DIR);
    migrate(
      db,
      migrations.filter((m) => m.version < 7)
    );
    db.prepare(`INSERT INTO users (id, name) VALUES (5, 'Old user')`).run();
    db.prepare(
      'INSERT INTO events (user_id, color_id, position, timestamp) VALUES (5, 0, 0, 1)'
    ).run();
    migrate(db, migrations);

    const users = db.prepare('SELECT id, email, password_hash, role FROM users ORDER BY id').all();
    assert.deepEqual(users, [
      { id: 0, email: null, password_hash: null, role: 'user' },
      { id: 5, email: null, password_hash: null, role: 'user' },
    ]);
    assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
    // New accounts get ids after the old ones
    const mif = new MifDb(db);
    assert.equal(mif.registerUser('a@vu.lt', 'h', 1).user.id, 6);
    // The events table still points at users
    assert.throws(() => mif.appendEvent({ user_id: 99, color_id: 0, position: 0 }), /FOREIGN KEY/);
  });

  it('registers an account that waits for verification, a repeat replaces the password', () => {
    const { mif } = accountsDb();
    const first = mif.registerUser('jonas@vu.lt', 'hash-1', 1000);
    assert.equal(first.pending, true);
    assert.deepEqual(
      { ...first.user },
      {
        id: first.user.id,
        email: 'jonas@vu.lt',
        password_hash: 'hash-1',
        role: 'user',
        created_at: 1000,
        verified_at: null,
        banned_at: null,
        ban_reason: null,
      }
    );
    mif.addEmailToken(hash('a'), first.user.id, 'verify', 5000);

    // Same account, new password, new period; the link of the first email is dead
    const again = mif.registerUser('jonas@vu.lt', 'hash-2', 2000);
    assert.equal(again.pending, true);
    assert.equal(again.user.id, first.user.id);
    assert.equal(again.user.password_hash, 'hash-2');
    assert.equal(again.user.created_at, 2000);
    assert.equal(mif.hasEmailToken(hash('a'), 'verify', 2000), false);
    assert.equal(mif.findUserByEmail('jonas@vu.lt')?.password_hash, 'hash-2');
    assert.equal(mif.findUserByEmail('nobody@vu.lt'), undefined);
  });

  it('leaves a verified account alone when its address registers again', () => {
    const { mif } = accountsDb();
    const { user } = mif.registerUser('jonas@vu.lt', 'hash-1', 1000);
    mif.addEmailToken(hash('a'), user.id, 'verify', 5000);
    assert.equal(mif.verifyEmail(hash('a'), 1500)?.verified_at, 1500);

    const again = mif.registerUser('jonas@vu.lt', 'hash-2', 2000);
    assert.equal(again.pending, false);
    assert.equal(again.user.password_hash, 'hash-1');
    assert.equal(again.user.created_at, 1000);
  });

  it('verifies by token once, not after it expires and not with a reset token', () => {
    const { mif } = accountsDb();
    const { user } = mif.registerUser('jonas@vu.lt', 'hash-1', 1000);
    mif.addEmailToken(hash('a'), user.id, 'verify', 5000);
    mif.addEmailToken(hash('b'), user.id, 'verify', 5000);
    mif.addEmailToken(hash('c'), user.id, 'reset', 5000);

    assert.equal(mif.verifyEmail(hash('a'), 5000), undefined); // expired
    assert.equal(mif.verifyEmail(hash('c'), 2000), undefined); // wrong purpose
    assert.equal(mif.verifyEmail(hash('x'), 2000), undefined); // unknown
    assert.equal(mif.findUserByEmail('jonas@vu.lt')?.verified_at, null);

    assert.equal(mif.verifyEmail(hash('a'), 2000)?.verified_at, 2000);
    // Used up, and the other verify token went with it; the reset token stays
    assert.equal(mif.verifyEmail(hash('a'), 2100), undefined);
    assert.equal(mif.verifyEmail(hash('b'), 2100), undefined);
    assert.equal(mif.hasEmailToken(hash('c'), 'reset', 2100), true);
  });

  it('keeps sessions until they expire or are deleted', () => {
    const { mif } = accountsDb();
    const { user } = mif.registerUser('jonas@vu.lt', 'hash-1', 1000);
    mif.createSession(hash('s'), user.id, 9000, 2000);

    const found = mif.findSession(hash('s'), 3000);
    assert.equal(found?.id, user.id);
    assert.equal(found?.email, 'jonas@vu.lt');
    assert.equal(found?.session_last_seen_at, 2000);
    assert.equal(mif.findSession(hash('s'), 9000), undefined); // expired
    assert.equal(mif.findSession(hash('x'), 3000), undefined);

    mif.touchSession(hash('s'), 4000);
    assert.equal(mif.findSession(hash('s'), 4500)?.session_last_seen_at, 4000);

    assert.equal(mif.deleteSession(hash('s')), true);
    assert.equal(mif.deleteSession(hash('s')), false);
    assert.equal(mif.findSession(hash('s'), 4500), undefined);
  });

  it('a password reset uses up the token, verifies the address and closes every session', () => {
    const { mif } = accountsDb();
    const { user } = mif.registerUser('jonas@vu.lt', 'hash-1', 1000);
    mif.createSession(hash('s'), user.id, 90_000, 2000);
    mif.createSession(hash('t'), user.id, 90_000, 2000);
    mif.addEmailToken(hash('a'), user.id, 'verify', 50_000);
    mif.addEmailToken(hash('r'), user.id, 'reset', 5000);

    assert.equal(mif.resetPassword(hash('r'), 'hash-2', 5000), undefined); // expired
    assert.equal(mif.resetPassword(hash('a'), 'hash-2', 3000), undefined); // wrong purpose
    assert.equal(mif.findUserByEmail('jonas@vu.lt')?.password_hash, 'hash-1');

    const reset = mif.resetPassword(hash('r'), 'hash-2', 3000);
    assert.equal(reset?.password_hash, 'hash-2');
    assert.equal(reset?.verified_at, 3000);
    assert.equal(mif.findSession(hash('s'), 3000), undefined);
    assert.equal(mif.findSession(hash('t'), 3000), undefined);
    assert.equal(mif.resetPassword(hash('r'), 'hash-3', 3100), undefined); // used
    assert.equal(mif.hasEmailToken(hash('a'), 'verify', 3100), false);
  });

  it('a password change keeps only the session it was made from', () => {
    const { mif } = accountsDb();
    const { user } = mif.registerUser('jonas@vu.lt', 'hash-1', 1000);
    const other = mif.registerUser('ona@vu.lt', 'hash-o', 1000).user;
    mif.createSession(hash('s'), user.id, 90_000, 2000);
    mif.createSession(hash('t'), user.id, 90_000, 2000);
    mif.createSession(hash('o'), other.id, 90_000, 2000);
    mif.addEmailToken(hash('r'), user.id, 'reset', 50_000);

    mif.changePassword(user.id, 'hash-2', hash('s'));
    assert.equal(mif.findUserByEmail('jonas@vu.lt')?.password_hash, 'hash-2');
    assert.equal(mif.findSession(hash('s'), 3000)?.id, user.id);
    assert.equal(mif.findSession(hash('t'), 3000), undefined);
    assert.equal(mif.findSession(hash('o'), 3000)?.id, other.id);
    // A reset link asked for before the change does not work after it
    assert.equal(mif.hasEmailToken(hash('r'), 'reset', 3000), false);
  });

  it('removes expired sessions, expired tokens and accounts never verified', () => {
    const { mif, db } = accountsDb();
    const old = mif.registerUser('old@vu.lt', 'h', 1000).user;
    const fresh = mif.registerUser('fresh@vu.lt', 'h', 1000 + DAY).user;
    const verified = mif.registerUser('verified@vu.lt', 'h', 1000).user;
    mif.addEmailToken(hash('o'), old.id, 'verify', 1000 + DAY);
    mif.addEmailToken(hash('v'), verified.id, 'verify', 1000 + DAY);
    mif.verifyEmail(hash('v'), 2000);
    mif.addEmailToken(hash('e'), verified.id, 'reset', 3000);
    mif.addEmailToken(hash('k'), verified.id, 'reset', 9000 + DAY);
    mif.createSession(hash('s'), verified.id, 4000, 2000);
    mif.createSession(hash('t'), verified.id, 9000 + DAY, 2000);

    const now = 2000 + DAY;
    assert.deepEqual(mif.removeExpiredAuth(now, now - DAY), { sessions: 1, tokens: 2, users: 1 });
    assert.equal(mif.findUserByEmail('old@vu.lt'), undefined);
    assert.equal(mif.findUserByEmail('fresh@vu.lt')?.id, fresh.id);
    assert.equal(mif.findUserByEmail('verified@vu.lt')?.id, verified.id);
    assert.equal(mif.findSession(hash('t'), now)?.id, verified.id);
    assert.equal(mif.hasEmailToken(hash('k'), 'reset', now), true);
    // An account past its day whose link was sent again later lives until that link expires
    const late = mif.registerUser('late@vu.lt', 'h', now).user;
    mif.addEmailToken(hash('l'), late.id, 'verify', now + 2 * DAY);
    const later = now + DAY + 1000;
    assert.equal(mif.removeExpiredAuth(later, later - DAY).users, 1); // fresh@vu.lt
    assert.equal(mif.findUserByEmail('late@vu.lt')?.id, late.id);
    assert.equal(mif.verifyEmail(hash('l'), later)?.id, late.id);
    // User 0 has no email: it is not an unverified account
    assert.equal(
      (db.prepare('SELECT count(*) AS n FROM users WHERE id = 0').get() as { n: number }).n,
      1
    );
  });

  it('makes a ready account for development, and sets its password again', () => {
    const { mif } = accountsDb();
    const made = mif.ensureVerifiedUser('dev@vu.lt', 'hash-1', 1000);
    assert.equal(made.verified_at, 1000);
    assert.equal(made.password_hash, 'hash-1');

    const again = mif.ensureVerifiedUser('dev@vu.lt', 'hash-2', 2000);
    assert.equal(again.id, made.id);
    assert.equal(again.password_hash, 'hash-2');
    assert.equal(again.verified_at, 1000);
    assert.equal(again.created_at, 1000);

    // An account still waiting for its email becomes verified
    const pending = mif.registerUser('ona@vu.lt', 'hash-o', 3000).user;
    assert.equal(mif.ensureVerifiedUser('ona@vu.lt', 'hash-p', 4000).verified_at, 4000);
    assert.equal(mif.findUserByEmail('ona@vu.lt')?.id, pending.id);
  });

  it('makes exactly the verified accounts of the list administrators', () => {
    const { mif } = accountsDb();
    const admin = mif.ensureVerifiedUser('admin@vu.lt', 'h', 1000);
    mif.ensureVerifiedUser('user@vu.lt', 'h', 1000);
    // In the list, but its owner has not opened the link yet
    mif.registerUser('pending@vu.lt', 'h', 1000);
    const list = ['admin@vu.lt', 'pending@vu.lt', 'nobody@vu.lt'];

    assert.deepEqual(mif.syncAdmins(list), { promoted: 1, demoted: 0 });
    assert.equal(mif.findUserByEmail('admin@vu.lt')?.role, 'admin');
    assert.equal(mif.findUserByEmail('pending@vu.lt')?.role, 'user');
    assert.equal(mif.findUserByEmail('user@vu.lt')?.role, 'user');
    // Nothing to do the second time
    assert.deepEqual(mif.syncAdmins(list), { promoted: 0, demoted: 0 });

    // Another list: the role moves
    assert.deepEqual(mif.syncAdmins(['user@vu.lt']), { promoted: 1, demoted: 1 });
    assert.equal(mif.findUserByEmail('admin@vu.lt')?.role, 'user');
    assert.equal(mif.getAccount(admin.id, 2000)?.role, 'user');
    assert.deepEqual(mif.syncAdmins([]), { promoted: 0, demoted: 1 });
  });

  it('blocks, unblocks and signs out an account, and logs each action', () => {
    const { mif } = accountsDb();
    const admin = mif.ensureVerifiedUser('admin@vu.lt', 'h', 1000);
    const user = mif.ensureVerifiedUser('jonas@vu.lt', 'h', 1000);
    mif.createSession(hash('s'), user.id, 90_000, 2000);
    mif.createSession(hash('t'), user.id, 2500, 2000); // expired by 3000
    assert.equal(mif.getAccount(user.id, 3000)?.sessions, 1);

    const blocked = mif.blockUser(admin.id, user.id, 'spam', 3000);
    assert.equal(blocked?.banned_at, 3000);
    assert.equal(blocked?.ban_reason, 'spam');
    assert.equal(blocked?.sessions, 0);
    assert.equal(mif.findSession(hash('s'), 3000), undefined);

    const unblocked = mif.unblockUser(admin.id, user.id, 4000);
    assert.equal(unblocked?.banned_at, null);
    assert.equal(unblocked?.ban_reason, null);

    mif.createSession(hash('u'), user.id, 90_000, 4000);
    assert.equal(mif.endUserSessions(admin.id, user.id, 5000), 1);
    assert.equal(mif.endUserSessions(admin.id, user.id, 5000), 0);

    // User 0 and unknown ids are not accounts: nothing happens and nothing is logged
    for (const id of [0, 999]) {
      assert.equal(mif.blockUser(admin.id, id, 'x', 6000), undefined);
      assert.equal(mif.unblockUser(admin.id, id, 6000), undefined);
      assert.equal(mif.endUserSessions(admin.id, id, 6000), undefined);
      assert.equal(mif.getAccount(id, 6000), undefined);
    }
    assert.deepEqual(
      mif
        .getAdminLog(10)
        .map((row) => [row.action, row.target_user_id, row.details, row.timestamp]),
      [
        ['end_sessions', user.id, null, 5000],
        ['end_sessions', user.id, null, 5000],
        ['unblock', user.id, null, 4000],
        ['block', user.id, 'spam', 3000],
      ]
    );
  });

  it('finds accounts by a part of the address, wildcards taken literally', () => {
    const { mif } = accountsDb();
    for (const email of ['jonas@vu.lt', 'jonas_2@vu.lt', 'ona@mif.vu.lt']) {
      mif.ensureVerifiedUser(email, 'h', 1000);
    }
    const emails = (text: string, limit = 20) =>
      mif.searchUsers(text, limit, 2000).map((user) => user.email);
    assert.deepEqual(emails('jonas'), ['jonas@vu.lt', 'jonas_2@vu.lt']);
    assert.deepEqual(emails('vu.lt', 2), ['jonas@vu.lt', 'jonas_2@vu.lt']);
    assert.deepEqual(emails('s_2'), ['jonas_2@vu.lt']);
    assert.deepEqual(emails('%'), []);
    assert.deepEqual(emails('\\'), []);
    assert.deepEqual(emails('gmail'), []);
  });

  it('deletes an account but keeps its row, its pixels and the admin log', () => {
    const { mif, db } = accountsDb();
    const admin = mif.ensureVerifiedUser('admin@vu.lt', 'h', 1000);
    const user = mif.ensureVerifiedUser('jonas@vu.lt', 'h', 1000);
    mif.createSession(hash('s'), user.id, 90_000, 2000);
    mif.addEmailToken(hash('r'), user.id, 'reset', 90_000);
    mif.addToWaitlist('jonas@vu.lt', 'w'.repeat(43), 2000);
    mif.appendEvent({ user_id: user.id, color_id: 0, position: 3 }, 2000);
    mif.blockUser(admin.id, user.id, 'spam', 2500);
    mif.unblockUser(admin.id, user.id, 2600);

    assert.equal(mif.deleteAccount(user.id), true);
    assert.equal(mif.findUserByEmail('jonas@vu.lt'), undefined);
    assert.equal(mif.getAccount(user.id, 3000), undefined);
    assert.equal(mif.hasEmailToken(hash('r'), 'reset', 3000), false);
    const count = (table: string) =>
      (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    assert.equal(count('sessions'), 0);
    assert.equal(count('waitlist'), 0);
    assert.equal(count('events'), 1);
    assert.equal(count('admin_log'), 2);
    assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);

    // Twice, user 0 and an unknown id: nothing to delete
    assert.equal(mif.deleteAccount(user.id), false);
    assert.equal(mif.deleteAccount(0), false);
    assert.equal(mif.deleteAccount(999), false);
    // The address is free again
    assert.notEqual(mif.registerUser('jonas@vu.lt', 'h2', 4000).user.id, user.id);
  });

  it('rejects an account without a password, an upper-case address and an unknown role', () => {
    const { db } = accountsDb();
    const insert = (columns: string, values: string) =>
      db.prepare(`INSERT INTO users (${columns}, created_at) VALUES (${values}, 1)`).run();
    assert.throws(() => insert('email', `'a@vu.lt'`), /CHECK constraint/);
    assert.throws(() => insert('password_hash', `'h'`), /CHECK constraint/);
    assert.throws(() => insert('email, password_hash', `'A@vu.lt', 'h'`), /CHECK constraint/);
    assert.throws(() => insert('email, password_hash, role', `'a@vu.lt', 'h', 'root'`), /CHECK/);
    insert('email, password_hash, role', `'a@vu.lt', 'h', 'admin'`);
    assert.throws(() => insert('email, password_hash', `'a@vu.lt', 'h'`), /UNIQUE constraint/);
  });
});
