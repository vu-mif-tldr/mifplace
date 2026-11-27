import * as crypto from 'node:crypto';

// Passwords are stored as Argon2id hashes (node:crypto since Node 24.7, no dependency) in the
// usual PHC string format, which other Argon2 libraries read too:
//   $argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt>$<key>     salt and key as base64
// The parameters are in the string, so they can be raised later without breaking old hashes.

export interface Argon2Params {
  // Memory cost in KiB
  memoryKiB: number;
  // Number of passes over the memory
  passes: number;
  // Number of lanes
  parallelism: number;
}

// OWASP Password Storage Cheat Sheet: m = 19 MiB, t = 2, p = 1. One hash takes 19 MiB and
// a few tens of milliseconds.
export const DEFAULT_ARGON2_PARAMS: Argon2Params = { memoryKiB: 19456, passes: 2, parallelism: 1 };

const SALT_BYTES = 16;
const KEY_BYTES = 32;
// The only version of Argon2 in use (1.3)
const VERSION = 19;

// Thrown when too many passwords wait to be hashed; the request is answered with 503.
export class HasherBusyError extends Error {
  constructor() {
    super('Too many passwords are being checked at once');
  }
}

function derive(password: string, salt: Buffer, params: Argon2Params): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.argon2(
      'argon2id',
      {
        // The same password typed on another keyboard may use other code points (ą as one
        // character or as a + ogonek); NFKC makes them one.
        message: Buffer.from(password.normalize('NFKC'), 'utf8'),
        nonce: salt,
        parallelism: params.parallelism,
        tagLength: KEY_BYTES,
        memory: params.memoryKiB,
        passes: params.passes,
      },
      (error, key) => (error ? reject(error) : resolve(key))
    );
  });
}

// PHC strings use base64 without the "=" padding
const base64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

function parse(stored: string): { params: Argon2Params; salt: Buffer; key: Buffer } | undefined {
  const match = stored.match(
    /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/
  );
  if (!match || Number(match[1]) !== VERSION) return undefined;
  const params = {
    memoryKiB: Number(match[2]),
    passes: Number(match[3]),
    parallelism: Number(match[4]),
  };
  // The limits of Argon2 itself; anything else would make the hash function throw
  if (params.passes < 1 || params.parallelism < 1 || params.memoryKiB < 8 * params.parallelism) {
    return undefined;
  }
  const salt = Buffer.from(match[5]!, 'base64');
  const key = Buffer.from(match[6]!, 'base64');
  if (salt.length < 8 || key.length !== KEY_BYTES) return undefined;
  return { params, salt, key };
}

// Hashes and checks passwords, a few at a time: every hash takes memory and a thread of the
// libuv pool, so a burst of sign-ins must wait in a queue instead of exhausting the container.
export class PasswordHasher {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  // Checked when the address has no account, so the answer takes as long as for a wrong password
  private dummy: Promise<string> | undefined;

  constructor(
    private readonly params: Argon2Params = DEFAULT_ARGON2_PARAMS,
    private readonly maxConcurrent = 3,
    private readonly maxWaiting = 100
  ) {
    // Said here, at start, and not by a TypeError on the first registration
    if (typeof crypto.argon2 !== 'function') {
      throw new Error(`Node 24.7 or newer is needed for crypto.argon2, this is ${process.version}`);
    }
  }

  async hash(password: string): Promise<string> {
    const salt = crypto.randomBytes(SALT_BYTES);
    const key = await this.limited(() => derive(password, salt, this.params));
    const { memoryKiB, passes, parallelism } = this.params;
    return `$argon2id$v=${VERSION}$m=${memoryKiB},t=${passes},p=${parallelism}$${base64(salt)}$${base64(key)}`;
  }

  // False for a wrong password and for a string that is not one of our hashes.
  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parse(stored);
    if (!parsed) return false;
    const key = await this.limited(() => derive(password, parsed.salt, parsed.params));
    return crypto.timingSafeEqual(key, parsed.key);
  }

  // Does the work of verify() for an address without an account. Always false.
  async verifyUnknown(password: string): Promise<false> {
    // A failed attempt (a full queue) is not kept: the next call makes the hash again
    this.dummy ??= this.hash(crypto.randomBytes(16).toString('base64url')).catch(
      (error: unknown) => {
        this.dummy = undefined;
        throw error;
      }
    );
    await this.verify(password, await this.dummy);
    return false;
  }

  private async limited<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrent) {
      if (this.waiting.length >= this.maxWaiting) throw new HasherBusyError();
      // Woken by the one that finishes, which hands its slot over
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running++;
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}
