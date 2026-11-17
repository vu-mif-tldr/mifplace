import type { UserRow } from '@mifplace/db';
import { ensureDevAccount, type DevAccount } from './dev-account.js';
import type { PasswordHasher } from './password.js';

// What the server does to the accounts at every start, in the order that matters: first the
// development account (outside production), then the roles, so an account made a moment ago
// can be an administrator at once and not only after the next restart.

export interface AccountsAtStart {
  // The id of the user of the development account, if there is one
  devUserId?: number;
  // How many accounts got and lost the role of an administrator
  promoted: number;
  demoted: number;
}

export async function prepareAccounts(
  store: {
    ensureVerifiedUser(email: string, passwordHash: string, now: number): UserRow;
    syncAdmins(emails: readonly string[]): { promoted: number; demoted: number };
  },
  options: { adminEmails: readonly string[]; devAccount?: DevAccount; hasher?: PasswordHasher }
): Promise<AccountsAtStart> {
  const devUserId = options.devAccount
    ? await ensureDevAccount(store, options.devAccount, options.hasher)
    : undefined;
  // ADMIN_EMAILS is the whole truth about who is an administrator
  return { devUserId, ...store.syncAdmins(options.adminEmails) };
}
