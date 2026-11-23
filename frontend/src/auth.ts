import {
  AuthErrorResponseSchema,
  AuthUserResponseSchema,
  type AuthErrorCode,
  type AuthUser,
  type ForgotPasswordRequest,
  type LoginRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
  type VerifyEmailRequest,
} from '@mifplace/shared';

// The accounts: /api/auth (docs/api.md, "Accounts"). The session is a cookie the browser keeps
// and sends by itself, so nothing about it is stored here.

// Why a request failed: the code of the server, or one of ours when the server gave none.
// 'rate_limited' is the per-IP limit (429 without a code), 'network' means no answer at all.
export type AuthFailure = AuthErrorCode | 'rate_limited' | 'network';

export type AuthResult<T = undefined> = { ok: true; value: T } | { ok: false; code: AuthFailure };

// What the page knows about the visitor: the signed-in user, or nobody
export type Session = AuthUser | 'anonymous';

async function failure(response: Response): Promise<AuthFailure> {
  const body = AuthErrorResponseSchema.safeParse(await response.json().catch(() => undefined));
  if (body.success && body.data.code) return body.data.code;
  return response.status === 429 ? 'rate_limited' : 'internal';
}

// Sends a JSON body to an account route. `read` takes the value out of a successful answer.
async function post<T>(
  path: string,
  body: unknown,
  read: (response: Response) => Promise<T>
): Promise<AuthResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: 'network' };
  }
  if (!response.ok) return { ok: false, code: await failure(response) };
  return { ok: true, value: await read(response) };
}

const nothing = () => Promise.resolve(undefined);

// Who is signed in. Throws when the server cannot be asked: the page then offers to try again.
export async function getSession(): Promise<Session> {
  const response = await fetch('/api/auth/me');
  if (response.status === 401) return 'anonymous';
  if (!response.ok) throw new Error('Could not load the session');
  const body = AuthUserResponseSchema.safeParse(await response.json());
  if (!body.success) throw new Error('The session from the server is invalid');
  return body.data.user;
}

export function signIn(email: string, password: string): Promise<AuthResult<AuthUser>> {
  return post('/login', { email, password } satisfies LoginRequest, async (response) => {
    return AuthUserResponseSchema.parse(await response.json()).user;
  });
}

// The server only sends an email; the account works once the link in it is confirmed.
export function register(email: string, password: string): Promise<AuthResult> {
  return post('/register', { email, password } satisfies RegisterRequest, nothing);
}

// The token of the link in the registration email.
export function verifyEmail(token: string): Promise<AuthResult> {
  return post('/verify', { token } satisfies VerifyEmailRequest, nothing);
}

export function forgotPassword(email: string): Promise<AuthResult> {
  return post('/password/forgot', { email } satisfies ForgotPasswordRequest, nothing);
}

// The token of the link in the "forgot password" email.
export function resetPassword(token: string, password: string): Promise<AuthResult> {
  return post('/password/reset', { token, password } satisfies ResetPasswordRequest, nothing);
}

export function signOut(): Promise<AuthResult> {
  return post('/logout', undefined, nothing);
}
