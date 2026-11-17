import { z } from 'zod';
import { isAllowedEmail } from './auth.js';

// Only Vilnius University addresses: vu.lt itself and any subdomain (mif.stud.vu.lt, mif.vu.lt, ...).
// Who may register an account is a setting of the server instead (ALLOWED_EMAIL_DOMAINS).
export function isVuEmail(email: string): boolean {
  return isAllowedEmail(email, ['vu.lt']);
}

// An address as typed in a form: spaces around it are dropped and it is stored in lower case,
// so Jonas@VU.lt and jonas@vu.lt are one person.
export const VuEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('not a valid email address'))
  .refine(isVuEmail, { error: 'only VU emails can join' });

// Body of POST /api/waitlist
export const WaitlistSignupRequestSchema = z.object({ email: VuEmailSchema });
export type WaitlistSignupRequest = z.infer<typeof WaitlistSignupRequestSchema>;

// Body of POST /api/waitlist/confirm and /api/waitlist/unsubscribe: the token from the email link
export const WaitlistTokenRequestSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, 'not a valid link'),
});
export type WaitlistTokenRequest = z.infer<typeof WaitlistTokenRequestSchema>;
