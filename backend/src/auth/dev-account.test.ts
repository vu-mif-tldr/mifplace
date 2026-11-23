import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS_DIR, MifDb, loadMigrations, migrate } from '@mifplace/db';
import { onOff } from '../env-number.js';
import { devAccountFromEnv, ensureDevAccount } from './dev-account.js';
import { PasswordHasher } from './password.js';
import { prepareAccounts } from './startup.js';

const account = { DEV_USER_EMAIL: 'Dev@VU.lt', DEV_USER_PASSWORD: 'a password for localhost' };

describe('devAccountFromEnv', () => {
  it('is nothing unless both settings are there', () => {
    assert.equal(devAccountFromEnv({}), undefined);
    assert.equal(devAccountFromEnv({ DEV_USER_EMAIL: '', DEV_USER_PASSWORD: '' }), undefined);
    assert.deepEqual(devAccountFromEnv(account), {
      email: 'dev@vu.lt',
      password: 'a password for localhost',
    });
  });

  it('stops the server at start in production, even with only one of them', () => {
    assert.throws(
      () => devAccountFromEnv({ ...account, NODE_ENV: 'production' }),
      /must not be set in production/
    );
    assert.throws(
      () => devAccountFromEnv({ DEV_USER_EMAIL: 'dev@vu.lt', NODE_ENV: 'production' }),
      /must not be set in production/
    );
    // Production without them is the normal case
    assert.equal(devAccountFromEnv({ NODE_ENV: 'production' }), undefined);
  });

  it('stops on half an account and on values the registration form would refuse', () => {
    assert.throws(() => devAccountFromEnv({ DEV_USER_EMAIL: 'dev@vu.lt' }), /Set both/);
    assert.throws(() => devAccountFromEnv({ DEV_USER_PASSWORD: 'a password' }), /Set both/);
    assert.throws(
      () => devAccountFromEnv({ ...account, DEV_USER_PASSWORD: 'short' }),
      /Invalid DEV_USER_EMAIL or DEV_USER_PASSWORD: password/
    );
    assert.throws(
      () => devAccountFromEnv({ ...account, DEV_USER_EMAIL: 'not an address' }),
      /Invalid DEV_USER_EMAIL or DEV_USER_PASSWORD: email/
    );
  });
});

describe('ensureDevAccount', () => {
  it('makes an account that can sign in at once, and keeps it over restarts', async () => {
    const db = new Database(':memory:');
    migrate(db, loadMigrations(MIGRATIONS_DIR));
    const mif = new MifDb(db);
    const hasher = new PasswordHasher({ memoryKiB: 8, passes: 1, parallelism: 1 });

    const id = await ensureDevAccount(
      mif,
      { email: 'dev@vu.lt', password: 'first password' },
      hasher,
      1000
    );
    const user = mif.findUserByEmail('dev@vu.lt')!;
    assert.equal(user.id, id);
    assert.equal(user.verified_at, 1000);
    assert.equal(await hasher.verify('first password', user.password_hash!), true);

    // The next start, with another password in .env: the same user, the new password
    const again = await ensureDevAccount(
      mif,
      { email: 'dev@vu.lt', password: 'second password' },
      hasher,
      2000
    );
    assert.equal(again, id);
    const updated = mif.findUserByEmail('dev@vu.lt')!;
    assert.equal(await hasher.verify('second password', updated.password_hash!), true);
    assert.equal(await hasher.verify('first password', updated.password_hash!), false);
    mif.close();
  });
});

describe('prepareAccounts', () => {
  const hasher = new PasswordHasher({ memoryKiB: 8, passes: 1, parallelism: 1 });
  const devAccount = { email: 'dev@vu.lt', password: 'a password for localhost' };

  it('makes the development account an administrator at the very first start', async () => {
    const db = new Database(':memory:');
    migrate(db, loadMigrations(MIGRATIONS_DIR));
    const mif = new MifDb(db);

    // A new database: the account does not exist before this start
    const first = await prepareAccounts(mif, { adminEmails: ['dev@vu.lt'], devAccount, hasher });
    assert.deepEqual(first, { devUserId: first.devUserId, promoted: 1, demoted: 0 });
    assert.equal(mif.findUserByEmail('dev@vu.lt')?.id, first.devUserId);
    assert.equal(mif.findUserByEmail('dev@vu.lt')?.role, 'admin');

    // The next start changes nothing; one without the address in the list takes the role away
    const again = await prepareAccounts(mif, { adminEmails: ['dev@vu.lt'], devAccount, hasher });
    assert.deepEqual(again, { devUserId: first.devUserId, promoted: 0, demoted: 0 });
    const without = await prepareAccounts(mif, { adminEmails: [], devAccount, hasher });
    assert.equal(without.demoted, 1);
    assert.equal(mif.findUserByEmail('dev@vu.lt')?.role, 'user');
    mif.close();
  });

  it('only sets the roles when there is no development account (production)', async () => {
    const db = new Database(':memory:');
    migrate(db, loadMigrations(MIGRATIONS_DIR));
    const mif = new MifDb(db);
    mif.ensureVerifiedUser('admin@vu.lt', 'h', 1000);
    const result = await prepareAccounts(mif, { adminEmails: ['admin@vu.lt'] });
    assert.deepEqual(result, { devUserId: undefined, promoted: 1, demoted: 0 });
    mif.close();
  });
});

describe('onOff', () => {
  it('reads true and false, and falls back when unset or empty', () => {
    assert.equal(onOff({ FLAG: 'true' }, 'FLAG', false), true);
    assert.equal(onOff({ FLAG: 'false' }, 'FLAG', true), false);
    assert.equal(onOff({}, 'FLAG', true), true);
    assert.equal(onOff({ FLAG: '' }, 'FLAG', false), false);
  });

  it('stops the server at start on anything else', () => {
    for (const value of ['1', 'yes', 'on', 'TRUE', ' true']) {
      assert.throws(() => onOff({ FLAG: value }, 'FLAG', false), /Invalid FLAG/, value);
    }
  });
});
