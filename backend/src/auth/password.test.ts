import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { DEFAULT_SCRYPT_PARAMS, HasherBusyError, PasswordHasher } from './password.js';

// Cheap parameters: the tests check the logic, not the cost
const cheap = { logN: 4, r: 8, p: 1 };

describe('PasswordHasher', () => {
  it('hashes with a new salt every time and verifies only the right password', async () => {
    const hasher = new PasswordHasher(cheap);
    const first = await hasher.hash('correct horse battery');
    const second = await hasher.hash('correct horse battery');
    assert.match(first, /^scrypt\$4\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first, second);
    assert.equal(await hasher.verify('correct horse battery', first), true);
    assert.equal(await hasher.verify('correct horse battery', second), true);
    assert.equal(await hasher.verify('correct horse batterz', first), false);
    assert.equal(await hasher.verify('', first), false);
  });

  it('takes the parameters from the stored hash, so old hashes survive a change', async () => {
    const old = await new PasswordHasher({ logN: 5, r: 8, p: 2 }).hash('correct horse battery');
    assert.match(old, /^scrypt\$5\$8\$2\$/);
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
    const notHashes = [
      '',
      'plain',
      'scrypt$4$8$1$salt',
      'bcrypt$4$8$1$c2FsdA$a2V5',
      'scrypt$x$8$1$c2FsdA$a2V5',
      'scrypt$0$8$1$c2FsdA$a2V5',
    ];
    for (const stored of notHashes) {
      assert.equal(await hasher.verify('correct horse battery', stored), false, stored);
    }
    // Right format, wrong key length
    assert.equal(await hasher.verify('correct horse battery', 'scrypt$4$8$1$c2FsdA$a2V5'), false);
    assert.equal(await hasher.verifyUnknown('correct horse battery'), false);
    assert.equal(await hasher.verifyUnknown('another'), false);
  });

  it('works with the real parameters (Node needs maxmem raised for them)', async () => {
    const hasher = new PasswordHasher();
    const hash = await hasher.hash('correct horse battery');
    const { logN, r, p } = DEFAULT_SCRYPT_PARAMS;
    assert.ok(hash.startsWith(`scrypt$${logN}$${r}$${p}$`));
    assert.equal(await hasher.verify('correct horse battery', hash), true);
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
