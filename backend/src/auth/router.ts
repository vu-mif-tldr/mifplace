import express, { Router, type Request, type Response } from 'express';
import type { EmailTokenPurpose, UserRow } from '@mifplace/db';
import {
  ChangePasswordRequestSchema,
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  ResetPasswordRequestSchema,
  VerifyEmailRequestSchema,
  hasSubaddress,
  isAllowedEmail,
  zodErrorMessage,
  type AuthErrorCode,
  type AuthErrorResponse,
  type AuthUserResponse,
} from '@mifplace/shared';
import { EmailBudget, type HourlyQuota } from '../email-budget.js';
import type { Mail, Mailer } from '../mailer.js';
import { limiter, perHour, type RateLimits } from '../rate-limits.js';
import { sameOrigin } from './guard.js';
import { alreadyRegisteredEmail, passwordResetEmail, verificationEmail } from './emails.js';
import { HasherBusyError, PasswordHasher } from './password.js';
import {
  createSessions,
  type Sessions,
  type SessionsEnded,
  type SessionStore,
} from './sessions.js';
import { FailureThrottle } from './throttle.js';
import { hashToken, newToken } from './tokens.js';

// Accounts: /api/auth (see docs/api.md, "Accounts"). Registration with an email address and
// a password, the address is verified by a link, a session cookie keeps the browser signed in.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How long the link of a registration works; the server deletes unverified accounts older
// than this.
export const VERIFY_WITHIN_MS = DAY;
// How long the link of "forgot my password" works
export const RESET_WITHIN_MS = HOUR;

// What the router needs from the database (MifDb implements it), injected so tests need no DB.
export interface AuthStore extends SessionStore {
  findUserByEmail(email: string): UserRow | undefined;
  registerUser(
    email: string,
    passwordHash: string,
    now: number
  ): { user: UserRow; pending: boolean };
  addEmailToken(
    tokenHash: string,
    userId: number,
    purpose: EmailTokenPurpose,
    expiresAt: number
  ): void;
  hasEmailToken(tokenHash: string, purpose: EmailTokenPurpose, now: number): boolean;
  verifyEmail(tokenHash: string, now: number): UserRow | undefined;
  resetPassword(tokenHash: string, passwordHash: string, now: number): UserRow | undefined;
  changePassword(userId: number, passwordHash: string, keepSessionHash: string): void;
}

export interface AuthOptions {
  store: AuthStore;
  mailer: Mailer;
  // Where the page is, e.g. https://vu.place: the email links point there. https turns on
  // the Secure cookie.
  publicUrl: string;
  // Addresses in these domains and their subdomains may register (ALLOWED_EMAIL_DOMAINS)
  emailDomains: string[];
  // The hourly quota shared with the other emails of the server. Left out, 40 an hour.
  quota?: HourlyQuota;
  // Origins allowed besides the page's own host (WS_ALLOWED_ORIGINS)
  allowedOrigins?: string[];
  // The sessions shared with the rest of the server; left out, the router makes its own
  sessions?: Sessions;
  // Told when sessions end other than by expiring, so open live connections can be closed
  onSessionsEnded?: (ended: SessionsEnded) => void;
  // Tests pass one with cheap parameters
  hasher?: PasswordHasher;
  now?: () => number;
}

export type AuthOkResponse = { success: true };

type AuthResponse = Response<AuthOkResponse | AuthUserResponse | AuthErrorResponse>;

function fail(res: AuthResponse, status: number, code: AuthErrorCode, error: string) {
  return res.status(status).json({ success: false, code, error });
}

// What went wrong with an email, without the error's text: an SMTP error usually quotes the
// recipient, and addresses do not belong in the logs.
function logMailFailure(error: unknown): void {
  const { code, responseCode, command } = (error ?? {}) as Record<string, unknown>;
  console.error(
    `Account email failed: code=${String(code ?? 'unknown')}, SMTP response=${String(responseCode ?? 'none')}, command=${String(command ?? 'none')}`
  );
}

const publicUser = (user: { email: string | null; role: UserRow['role'] }) => ({
  email: user.email ?? '',
  role: user.role,
});

export function createAuthRouter(
  {
    store,
    mailer,
    publicUrl,
    emailDomains,
    quota,
    allowedOrigins = [],
    onSessionsEnded,
    hasher = new PasswordHasher(),
    now = Date.now,
    sessions = createSessions({ store, publicUrl, now }),
  }: AuthOptions,
  // Requests per IP (rate-limits.ts); the limits per account and per address below are separate
  limits: Pick<
    RateLimits,
    'authRegisterPerHour' | 'authLoginPerMinute' | 'authPasswordPerHour' | 'authPerMinute'
  >
): Router {
  const router = Router();

  // Emails to one address: at most one a minute and five a day, whatever they are about.
  const budget = new EmailBudget(MINUTE, 5, quota ?? 40);

  // Wrong passwords. From one network for one account: 5 in 15 minutes. For one account from
  // anywhere: 30 an hour, so guessing from many addresses is slow too, while one person
  // cannot keep somebody else locked out with a handful of requests.
  const perClient = new FailureThrottle(5, 15 * MINUTE);
  const perAccount = new FailureThrottle(30, HOUR);

  // Each limiter goes before the body is parsed
  const json = express.json();

  // The hash an unknown address is checked against is made on first use; done now, the first
  // such sign-in does not take longer than the others.
  hasher.verifyUnknown('').catch(() => {});

  // Sends in the background: the answer must not take longer for an address that has an
  // account than for one that has not. A failure is logged; the user can ask again.
  function sendLater(mail: Mail, email: string, time: number): void {
    budget.record(email, time);
    mailer.send(mail).catch((error: unknown) => {
      logMailFailure(error);
      budget.release(email, time);
    });
  }

  // A new token of that purpose for the user; only its hash is stored.
  function issueToken(userId: number, purpose: EmailTokenPurpose, time: number): string {
    const token = newToken();
    const ttl = purpose === 'verify' ? VERIFY_WITHIN_MS : RESET_WITHIN_MS;
    store.addEmailToken(hashToken(token), userId, purpose, time + ttl);
    return token;
  }

  // Checks a password for an address, counting the failures. 'blocked': too many wrong
  // passwords, this one was not even checked.
  async function checkPassword(
    email: string,
    password: string,
    ip: string | undefined,
    time: number
  ): Promise<{ result: 'blocked' } | { result: 'wrong' } | { result: 'ok'; user: UserRow }> {
    const client = `${email}|${ip ?? ''}`;
    if (perClient.blocked(client, time) || perAccount.blocked(email, time)) {
      return { result: 'blocked' };
    }
    // Counted as a failure before the slow check, so requests sent at once cannot all slip
    // under the limit; taken back when the password is right or could not be checked.
    perClient.fail(client, time);
    perAccount.fail(email, time);
    const takeBack = () => {
      perClient.undo(client, time);
      perAccount.undo(email, time);
    };
    let user: UserRow | undefined;
    let ok: boolean;
    try {
      user = store.findUserByEmail(email);
      ok = user?.password_hash
        ? await hasher.verify(password, user.password_hash)
        : await hasher.verifyUnknown(password);
    } catch (error) {
      takeBack();
      throw error;
    }
    if (!user || !ok) return { result: 'wrong' };
    takeBack();
    perClient.clear(client);
    return { result: 'ok', user };
  }

  // An error inside a handler becomes a JSON answer instead of Express's HTML page.
  function route(handler: (req: Request, res: AuthResponse) => Promise<unknown> | unknown) {
    return async (req: Request, res: AuthResponse) => {
      try {
        await handler(req, res);
      } catch (error) {
        if (error instanceof HasherBusyError) {
          return fail(res, 503, 'busy', 'The server is busy, please try again in a moment.');
        }
        // The path comes from the request, so it is an argument, never the format string
        console.error('%s /api/auth%s failed:', req.method, req.path, error);
        return fail(res, 500, 'internal', 'Internal server error');
      }
    };
  }

  router.use((_req, res, next) => {
    // Answers about an account must not be kept by a cache
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(sameOrigin(allowedOrigins));

  // 202 for a new address, for one waiting to be verified and for one that has an account
  // alike: the form must not tell who is registered. The owner of the address learns the rest
  // from the email.
  router.post(
    '/register',
    perHour(
      limits.authRegisterPerHour,
      'Too many registrations from your network, please try later.'
    ),
    json,
    route(async (req, res) => {
      const body = RegisterRequestSchema.safeParse(req.body);
      if (!body.success) return fail(res, 400, 'invalid_request', zodErrorMessage(body.error));
      const { email, password } = body.data;
      if (!isAllowedEmail(email, emailDomains)) {
        return fail(
          res,
          400,
          'email_not_allowed',
          `Only ${emailDomains.join(', ')} addresses can register.`
        );
      }
      if (hasSubaddress(email)) {
        return fail(res, 400, 'email_not_allowed', 'Addresses with "+" cannot register.');
      }
      const time = now();

      const verdict = budget.check(email, time);
      if (verdict === 'global') {
        return fail(
          res,
          503,
          'mail_unavailable',
          'Too many emails right now, please try again in an hour.'
        );
      }
      // This address got an email a moment ago (or enough for today): nothing changes, so
      // nobody can swap the password of an account that is waiting for its owner's click.
      if (verdict === 'address') return res.status(202).json({ success: true });

      const passwordHash = await hasher.hash(password);
      const { user, pending } = store.registerUser(email, passwordHash, time);
      // A blocked account gets no emails
      if (!pending && user.banned_at !== null) return res.status(202).json({ success: true });

      budget.record(email, time);
      try {
        await mailer.send(
          pending
            ? verificationEmail(email, publicUrl, issueToken(user.id, 'verify', time))
            : alreadyRegisteredEmail(email, publicUrl)
        );
      } catch (error) {
        logMailFailure(error);
        budget.release(email, time);
        return fail(
          res,
          503,
          'mail_unavailable',
          'Could not send the email, please try again later.'
        );
      }
      if (pending) console.log(`Account registered: user ${user.id}, waiting for verification`);
      return res.status(202).json({ success: true });
    })
  );

  // The button on the page the email link opens. It does not sign in: the owner signs in
  // with the password next, which shows at once if somebody else registered the address.
  router.post(
    '/verify',
    limiter(limits.authPerMinute),
    json,
    route((req, res) => {
      const body = VerifyEmailRequestSchema.safeParse(req.body);
      if (!body.success) return fail(res, 400, 'invalid_request', zodErrorMessage(body.error));
      const user = store.verifyEmail(hashToken(body.data.token), now());
      if (!user) {
        return fail(
          res,
          404,
          'invalid_token',
          'This link is unknown or has expired, please register again.'
        );
      }
      console.log(`Account verified: user ${user.id}`);
      return res.json({ success: true });
    })
  );

  router.post(
    '/login',
    limiter(limits.authLoginPerMinute, 'Too many sign-ins from your network, please try later.'),
    json,
    route(async (req, res) => {
      const body = LoginRequestSchema.safeParse(req.body);
      if (!body.success) return fail(res, 400, 'invalid_request', zodErrorMessage(body.error));
      const { email, password } = body.data;
      const time = now();

      const check = await checkPassword(email, password, req.ip, time);
      if (check.result === 'blocked') {
        return fail(
          res,
          429,
          'too_many_attempts',
          'Too many wrong passwords, please try again later.'
        );
      }
      // One answer for an unknown address and a wrong password
      if (check.result === 'wrong') {
        return fail(res, 401, 'invalid_credentials', 'Wrong email or password.');
      }
      const { user } = check;
      if (user.banned_at !== null) return fail(res, 403, 'banned', 'This account is blocked.');
      if (user.verified_at === null) {
        // The password is right, so this is the owner: the link is sent once more
        if (budget.check(email, time) === 'ok') {
          const token = issueToken(user.id, 'verify', time);
          sendLater(verificationEmail(email, publicUrl, token), email, time);
        }
        return fail(
          res,
          403,
          'email_not_verified',
          'Confirm your email address first: open the link we sent you.'
        );
      }

      sessions.start(res, user.id);
      return res.json({ success: true, user: publicUser(user) });
    })
  );

  // Always 200: signing out without a session is not an error.
  router.post(
    '/logout',
    limiter(limits.authPerMinute),
    route((req, res) => {
      const ended = sessions.end(req.headers.cookie, res);
      if (ended) onSessionsEnded?.({ session: ended });
      return res.json({ success: true });
    })
  );

  // Who is signed in; the page asks this when it opens.
  router.get(
    '/me',
    limiter(limits.authPerMinute),
    route((req, res) => {
      const user = sessions.authenticate(req.headers.cookie);
      if (!user) return fail(res, 401, 'unauthenticated', 'Not signed in.');
      return res.json({ success: true, user: publicUser(user) });
    })
  );

  // 202 whether the address has an account or not.
  router.post(
    '/password/forgot',
    perHour(limits.authPasswordPerHour),
    json,
    route((req, res) => {
      const body = ForgotPasswordRequestSchema.safeParse(req.body);
      if (!body.success) return fail(res, 400, 'invalid_request', zodErrorMessage(body.error));
      const { email } = body.data;
      const time = now();

      // Checked before the account is looked up, so the answer does not depend on it
      const verdict = budget.check(email, time);
      if (verdict === 'global') {
        return fail(
          res,
          503,
          'mail_unavailable',
          'Too many emails right now, please try again in an hour.'
        );
      }
      const user = verdict === 'ok' ? store.findUserByEmail(email) : undefined;
      if (user && user.banned_at === null) {
        const token = issueToken(user.id, 'reset', time);
        sendLater(passwordResetEmail(email, publicUrl, token), email, time);
      }
      return res.status(202).json({ success: true });
    })
  );

  // The button on the page the reset link opens. Signs every browser of the account out.
  router.post(
    '/password/reset',
    perHour(limits.authPasswordPerHour),
    json,
    route(async (req, res) => {
      const body = ResetPasswordRequestSchema.safeParse(req.body);
      if (!body.success) return fail(res, 400, 'invalid_request', zodErrorMessage(body.error));
      const tokenHash = hashToken(body.data.token);
      const time = now();
      const expired = () =>
        fail(res, 404, 'invalid_token', 'This link is unknown or has expired, please ask again.');

      // Looked at before the costly hash; used up, with the same check, after it
      if (!store.hasEmailToken(tokenHash, 'reset', time)) return expired();
      const passwordHash = await hasher.hash(body.data.password);
      const user = store.resetPassword(tokenHash, passwordHash, now());
      if (!user) return expired();
      onSessionsEnded?.({ userId: user.id });
      console.log(`Password reset: user ${user.id}`);
      return res.json({ success: true });
    })
  );

  // For a signed-in user who knows the current password. Signs the other browsers out.
  router.post(
    '/password/change',
    perHour(limits.authPasswordPerHour),
    json,
    route(async (req, res) => {
      const session = sessions.authenticate(req.headers.cookie);
      if (!session) return fail(res, 401, 'unauthenticated', 'Not signed in.');
      const body = ChangePasswordRequestSchema.safeParse(req.body);
      if (!body.success) return fail(res, 400, 'invalid_request', zodErrorMessage(body.error));

      const check = await checkPassword(session.email, body.data.currentPassword, req.ip, now());
      if (check.result === 'blocked') {
        return fail(
          res,
          429,
          'too_many_attempts',
          'Too many wrong passwords, please try again later.'
        );
      }
      // 403, not 401: the session is fine, the page must not send the user to sign in
      if (check.result === 'wrong') {
        return fail(res, 403, 'invalid_credentials', 'The current password is wrong.');
      }
      const passwordHash = await hasher.hash(body.data.newPassword);
      store.changePassword(session.id, passwordHash, session.tokenHash);
      onSessionsEnded?.({ userId: session.id, exceptSession: session.tokenHash });
      console.log(`Password changed: user ${session.id}`);
      return res.json({ success: true });
    })
  );

  return router;
}
