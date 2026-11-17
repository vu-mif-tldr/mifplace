import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Passwords are stored as scrypt hashes (node:crypto, no dependency):
//   scrypt$<log2 N>$<r>$<p>$<salt>$<key>     salt and key as base64url
// The parameters are in the string, so they can be raised later without breaking old hashes.

export interface ScryptParams {
  // CPU and memory cost as a power of two: N = 2 ** logN
  logN: number;
  r: number;
  p: number;
}

// OWASP Password Storage Cheat Sheet: N = 2^15, r = 8, p = 3. One hash takes 32 MiB
// (128 * N * r bytes) and about 0.2 s.
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { logN: 15, r: 8, p: 3 };

const SALT_BYTES = 16;
const KEY_BYTES = 32;

// Thrown when too many passwords wait to be hashed; the request is answered with 503.
export class HasherBusyError extends Error {
  constructor() {
    super('Too many passwords are being checked at once');
  }
}

function derive(password: string, salt: Buffer, { logN, r, p }: ScryptParams): Promise<Buffer> {
  const N = 2 ** logN;
  return new Promise((resolve, reject) => {
    scrypt(
      // The same password typed on another keyboard may use other code points (ą as one
      // character or as a + ogonek); NFKC makes them one.
      password.normalize('NFKC'),
      salt,
      KEY_BYTES,
      // Node's default maxmem (32 MiB) is below what these parameters need
      { N, r, p, maxmem: 256 * N * r },
      (error, key) => (error ? reject(error) : resolve(key))
    );
  });
}

function parse(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | undefined {
  const [name, logN, r, p, salt, key] = stored.split('$');
  if (name !== 'scrypt' || !salt || !key) return undefined;
  const params = { logN: Number(logN), r: Number(r), p: Number(p) };
  if (![params.logN, params.r, params.p].every((n) => Number.isInteger(n) && n > 0)) {
    return undefined;
  }
  return { params, salt: Buffer.from(salt, 'base64url'), key: Buffer.from(key, 'base64url') };
}

// Hashes and checks passwords, a few at a time: every hash takes 32 MiB and a thread of the
// libuv pool, so a burst of sign-ins must wait in a queue instead of exhausting the container.
export class PasswordHasher {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  // Checked when the address has no account, so the answer takes as long as for a wrong password
  private dummy: Promise<string> | undefined;

  constructor(
    private readonly params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
    private readonly maxConcurrent = 3,
    private readonly maxWaiting = 100
  ) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await this.limited(() => derive(password, salt, this.params));
    const { logN, r, p } = this.params;
    return `scrypt$${logN}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
  }

  // False for a wrong password and for a string that is not one of our hashes.
  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parse(stored);
    if (!parsed) return false;
    const key = await this.limited(() => derive(password, parsed.salt, parsed.params));
    return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
  }

  // Does the work of verify() for an address without an account. Always false.
  async verifyUnknown(password: string): Promise<false> {
    // A failed attempt (a full queue) is not kept: the next call makes the hash again
    this.dummy ??= this.hash(randomBytes(16).toString('base64url')).catch((error: unknown) => {
      this.dummy = undefined;
      throw error;
    });
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
