import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { DEFAULT_ARGON2_PARAMS, HasherBusyError, PasswordHasher } from './password.js';

// Cheap parameters: the tests check the logic, not the cost
const cheap = { memoryKiB: 8, passes: 1, parallelism: 1 };

describe('PasswordHasher', () => {
  it('hashes with a new salt every time and verifies only the right password', async () => {
    const hasher = new PasswordHasher(cheap);
    const first = await hasher.hash('correct horse battery');
    const second = await hasher.hash('correct horse battery');
    // 16 bytes of salt and 32 bytes of key, base64 without padding
    assert.match(first, /^\$argon2id\$v=19\$m=8,t=1,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    assert.notEqual(first, second);
    assert.equal(await hasher.verify('correct horse battery', first), true);
    assert.equal(await hasher.verify('correct horse battery', second), true);
    assert.equal(await hasher.verify('correct horse batterz', first), false);
    assert.equal(await hasher.verify('', first), false);
  });

  it('takes the parameters from the stored hash, so old hashes survive a change', async () => {
    const old = await new PasswordHasher({ memoryKiB: 16, passes: 2, parallelism: 2 }).hash(
      'correct horse battery'
    );
    assert.ok(old.startsWith('$argon2id$v=19$m=16,t=2,p=2$'));
    assert.equal(await new PasswordHasher(cheap).verify('correct horse battery', old), true);
  });

  it('treats the same letters typed as other code points as one password', async () => {
    const hasher = new PasswordHasher(cheap);
    // "ą" and "ž" as one character each, then as a letter with a combining mark
    const hash = await hasher.hash('slaptaąžodis');
    assert.equal(await hasher.verify('slaptaąžodis', hash), true);
  });

  it('is false for anything that is not one of our hashes', async () => {
    const hasher = new PasswordHasher(cheap);
    const key = 'A'.repeat(43);
    const notHashes = [
      '',
      'plain',
      '$argon2id$v=19$m=8,t=1,p=1$c29tZXNhbHQ',
      // Other variants, another version
      `$argon2i$v=19$m=8,t=1,p=1$c29tZXNhbHQ$${key}`,
      `$argon2id$v=16$m=8,t=1,p=1$c29tZXNhbHQ$${key}`,
      // Parameters Argon2 does not accept
      `$argon2id$v=19$m=4,t=1,p=1$c29tZXNhbHQ$${key}`,
      `$argon2id$v=19$m=8,t=0,p=1$c29tZXNhbHQ$${key}`,
      `$argon2id$v=19$m=8,t=1,p=0$c29tZXNhbHQ$${key}`,
      `$argon2id$v=19$m=x,t=1,p=1$c29tZXNhbHQ$${key}`,
      // A salt that is too short, a key of another length
      `$argon2id$v=19$m=8,t=1,p=1$c2FsdA$${key}`,
      '$argon2id$v=19$m=8,t=1,p=1$c29tZXNhbHQ$a2V5',
    ];
    for (const stored of notHashes) {
      assert.equal(await hasher.verify('correct horse battery', stored), false, stored);
    }
    // Right format, wrong key
    assert.equal(
      await hasher.verify('correct horse battery', `$argon2id$v=19$m=8,t=1,p=1$c29tZXNhbHQ$${key}`),
      false
    );
    assert.equal(await hasher.verifyUnknown('correct horse battery'), false);
    assert.equal(await hasher.verifyUnknown('another'), false);
  });

  it('works with the real parameters', async () => {
    const hasher = new PasswordHasher();
    const hash = await hasher.hash('correct horse battery');
    const { memoryKiB, passes, parallelism } = DEFAULT_ARGON2_PARAMS;
    assert.ok(hash.startsWith(`$argon2id$v=19$m=${memoryKiB},t=${passes},p=${parallelism}$`));
    assert.equal(await hasher.verify('correct horse battery', hash), true);
    assert.equal(await hasher.verify('correct horse batterz', hash), false);
  });

  it('runs a few at a time, queues the rest and refuses when the queue is full', async () => {
    // One at a time, one may wait
    const hasher = new PasswordHasher(cheap, 1, 1);
    const running = hasher.hash('first password');
    const waiting = hasher.hash('second password');
    await assert.rejects(hasher.hash('third password'), HasherBusyError);
    const [first, second] = await Promise.all([running, waiting]);
    assert.equal(await hasher.verify('first password', first), true);
    assert.equal(await hasher.verify('second password', second), true);
    // The slots are free again
    assert.equal(await hasher.verify('third password', await hasher.hash('third password')), true);
  });

  it('checks an unknown address again after a full queue, the failure is not remembered', async () => {
    const hasher = new PasswordHasher(cheap, 1, 0);
    const running = hasher.hash('first password');
    await assert.rejects(hasher.verifyUnknown('some password'), HasherBusyError);
    await running;
    assert.equal(await hasher.verifyUnknown('some password'), false);
  });
});
