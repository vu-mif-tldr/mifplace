import { RegisterRequestSchema, zodErrorMessage } from '@mifplace/shared';
import type { UserRow } from '@mifplace/db';
import { PasswordHasher } from './password.js';

// A ready account for local development: DEV_USER_EMAIL and DEV_USER_PASSWORD in .env. The
// backend creates it at start, verified, so a developer can sign in without the email and
// the tools (pixel-rain) can sign in through the normal API. There is no way around sign-in
// in the code, only this account, and never in production.

export interface DevAccount {
  email: string;
  password: string;
}

// The account from the environment, undefined when neither setting is there. Stops the
// server at start when they are set in production, when only one is set, or when they would
// not pass the registration form (any domain is fine: nobody has to receive an email).
export function devAccountFromEnv(env: NodeJS.ProcessEnv = process.env): DevAccount | undefined {
  const email = env.DEV_USER_EMAIL;
  const password = env.DEV_USER_PASSWORD;
  if (!email && !password) return undefined;
  if (env.NODE_ENV === 'production') {
    throw new Error('DEV_USER_EMAIL and DEV_USER_PASSWORD must not be set in production');
  }
  if (!email || !password) {
    throw new Error('Set both DEV_USER_EMAIL and DEV_USER_PASSWORD, or neither');
  }
  const account = RegisterRequestSchema.safeParse({ email, password });
  if (!account.success) {
    throw new Error(
      `Invalid DEV_USER_EMAIL or DEV_USER_PASSWORD: ${zodErrorMessage(account.error)}`
    );
  }
  return account.data;
}

// Creates the account, or sets its password again if it exists. Returns the id of its user.
export async function ensureDevAccount(
  store: { ensureVerifiedUser(email: string, passwordHash: string, now: number): UserRow },
  account: DevAccount,
  hasher: PasswordHasher = new PasswordHasher(),
  now: number = Date.now()
): Promise<number> {
  const passwordHash = await hasher.hash(account.password);
  return store.ensureVerifiedUser(account.email, passwordHash, now).id;
}
