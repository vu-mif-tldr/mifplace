import { z } from 'zod';
import { ErrorResponseSchema } from './api.js';

// Accounts: sign-in with an email address and a password (docs/api.md, "Accounts").
// The backend checks requests with these schemas, the frontend checks the forms and the
// responses with the same ones.

export const UserRoleSchema = z.enum(['user', 'admin']);
export type UserRole = z.infer<typeof UserRoleSchema>;

// Is the address in one of the domains or in a subdomain of one? ['vu.lt'] allows vu.lt,
// mif.vu.lt, mif.stud.vu.lt, ... Which domains may register is a setting of the server (FR-2).
export function isAllowedEmail(email: string, domains: readonly string[]): boolean {
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

// name+anything@... reaches the mailbox of name@... (Microsoft 365, which VU uses, does this),
// so one person could register any number of accounts.
export function hasSubaddress(email: string): boolean {
  return email.slice(0, email.lastIndexOf('@')).includes('+');
}

// An address as typed in a form: spaces around it are dropped and it is stored in lower case,
// so Jonas@VU.lt and jonas@vu.lt are one account. Whether its domain may register is checked
// apart (isAllowedEmail), the list is known only to the server.
export const AccountEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('not a valid email address'));

export const PASSWORD_MIN_LENGTH = 10;
// Hashing time grows with the length, so there is an upper limit too
export const PASSWORD_MAX_LENGTH = 128;

// A password being set. Length is the only rule: no required digits or symbols.
export const NewPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `password must be at most ${PASSWORD_MAX_LENGTH} characters`);

// A password being checked against the stored one: the rules for new passwords may change,
// an existing one must still be accepted.
const CurrentPasswordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

// The token from an email link: 32 random bytes as base64url
export const EmailTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'not a valid link');

// Body of POST /api/auth/register
export const RegisterRequestSchema = z.object({
  email: AccountEmailSchema,
  password: NewPasswordSchema,
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

// Body of POST /api/auth/login
export const LoginRequestSchema = z.object({
  email: AccountEmailSchema,
  password: CurrentPasswordSchema,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// Body of POST /api/auth/verify
export const VerifyEmailRequestSchema = z.object({ token: EmailTokenSchema });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

// Body of POST /api/auth/password/forgot
export const ForgotPasswordRequestSchema = z.object({ email: AccountEmailSchema });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

// Body of POST /api/auth/password/reset
export const ResetPasswordRequestSchema = z.object({
  token: EmailTokenSchema,
  password: NewPasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

// Body of POST /api/auth/password/change
export const ChangePasswordRequestSchema = z.object({
  currentPassword: CurrentPasswordSchema,
  newPassword: NewPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

// The signed-in user, as the page sees it
export const AuthUserSchema = z.object({
  email: z.string(),
  role: UserRoleSchema,
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

// 200 response of POST /api/auth/login and GET /api/auth/me
export const AuthUserResponseSchema = z.object({
  success: z.literal(true),
  user: AuthUserSchema,
});
export type AuthUserResponse = z.infer<typeof AuthUserResponseSchema>;

// Why an /api/auth request failed, for the page to pick its own text. The error text next to
// it is English and for developers.
export const AuthErrorCodeSchema = z.enum([
  // 400: the body does not match the schema
  'invalid_request',
  // 400: the address is not in an allowed domain, or has a "+" part
  'email_not_allowed',
  // 401 on login, 403 on password change: wrong email or password
  'invalid_credentials',
  // 401: no session, or it has expired
  'unauthenticated',
  // 403: the password is right, the address is not verified yet
  'email_not_verified',
  // 403: the account is blocked
  'banned',
  // 403: the request comes from another site
  'forbidden_origin',
  // 404: the link from the email is unknown, used or expired
  'invalid_token',
  // 429: too many wrong passwords for this account
  'too_many_attempts',
  // 503: the email could not be sent, or the hourly mail quota is used up
  'mail_unavailable',
  // 503: too many passwords are being checked at once
  'busy',
  // 500
  'internal',
]);
export type AuthErrorCode = z.infer<typeof AuthErrorCodeSchema>;

// Body of an /api/auth error response. The per-IP rate limit (429) has no code.
export const AuthErrorResponseSchema = ErrorResponseSchema.extend({
  code: AuthErrorCodeSchema.optional(),
});
export type AuthErrorResponse = z.infer<typeof AuthErrorResponseSchema>;
