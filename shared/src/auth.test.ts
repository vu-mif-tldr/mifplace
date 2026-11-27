import { describe, expect, it } from 'vitest';
import {
  AccountEmailSchema,
  AuthErrorResponseSchema,
  AuthUserResponseSchema,
  ChangePasswordRequestSchema,
  EmailTokenSchema,
  LoginRequestSchema,
  NewPasswordSchema,
  RegisterRequestSchema,
  hasSubaddress,
  isAllowedEmail,
} from './auth.js';

describe('isAllowedEmail', () => {
  it('accepts the listed domains and their subdomains only', () => {
    const domains = ['vu.lt', 'example.org'];
    expect(isAllowedEmail('a@vu.lt', domains)).toBe(true);
    expect(isAllowedEmail('a@mif.stud.vu.lt', domains)).toBe(true);
    expect(isAllowedEmail('a@MIF.VU.LT', domains)).toBe(true);
    expect(isAllowedEmail('a@example.org', domains)).toBe(true);
    expect(isAllowedEmail('a@notvu.lt', domains)).toBe(false);
    expect(isAllowedEmail('a@vu.lt.evil.com', domains)).toBe(false);
    expect(isAllowedEmail('vu.lt', domains)).toBe(false);
    expect(isAllowedEmail('a@vu.lt', [])).toBe(false);
  });
});

describe('hasSubaddress', () => {
  it('finds a plus in the part before the @ only', () => {
    expect(hasSubaddress('jonas+1@vu.lt')).toBe(true);
    expect(hasSubaddress('jonas@vu.lt')).toBe(false);
    expect(hasSubaddress('jonas@a+b.vu.lt')).toBe(false);
  });
});

describe('AccountEmailSchema', () => {
  it('trims and lower-cases the address, whatever its domain', () => {
    expect(AccountEmailSchema.parse('  Jonas@MIF.stud.vu.lt ')).toBe('jonas@mif.stud.vu.lt');
    expect(AccountEmailSchema.parse('a@gmail.com')).toBe('a@gmail.com');
  });

  it('rejects broken and too long addresses', () => {
    expect(AccountEmailSchema.safeParse('a@b@vu.lt').success).toBe(false);
    expect(AccountEmailSchema.safeParse('@vu.lt').success).toBe(false);
    expect(AccountEmailSchema.safeParse(`${'a'.repeat(250)}@vu.lt`).success).toBe(false);
    expect(AccountEmailSchema.safeParse(42).success).toBe(false);
  });
});

describe('NewPasswordSchema', () => {
  it('accepts 10 to 128 characters of any kind', () => {
    expect(NewPasswordSchema.safeParse('aaaaaaaaaa').success).toBe(true);
    expect(NewPasswordSchema.safeParse('ą'.repeat(128)).success).toBe(true);
    expect(NewPasswordSchema.safeParse('aaaaaaaaa').success).toBe(false);
    expect(NewPasswordSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(NewPasswordSchema.safeParse(1234567890).success).toBe(false);
  });
});

describe('request schemas', () => {
  it('registration needs a password of the new length, sign-in takes any stored one', () => {
    expect(RegisterRequestSchema.safeParse({ email: 'a@vu.lt', password: 'short' }).success).toBe(
      false
    );
    expect(LoginRequestSchema.safeParse({ email: 'a@vu.lt', password: 'short' }).success).toBe(
      true
    );
    expect(LoginRequestSchema.safeParse({ email: 'a@vu.lt', password: '' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ email: 'a@vu.lt' }).success).toBe(false);
  });

  it('a password change needs both passwords', () => {
    expect(
      ChangePasswordRequestSchema.safeParse({ currentPassword: 'old', newPassword: 'new-enough' })
        .success
    ).toBe(true);
    expect(ChangePasswordRequestSchema.safeParse({ newPassword: 'new-enough' }).success).toBe(
      false
    );
  });

  it('an email token is 43 base64url characters', () => {
    expect(EmailTokenSchema.safeParse('A'.repeat(43)).success).toBe(true);
    expect(EmailTokenSchema.safeParse('A'.repeat(42)).success).toBe(false);
    expect(EmailTokenSchema.safeParse(`${'A'.repeat(42)}/`).success).toBe(false);
  });
});

describe('response schemas', () => {
  it('a user has an email and a known role', () => {
    const ok = { success: true, user: { email: 'a@vu.lt', role: 'admin' } };
    expect(AuthUserResponseSchema.safeParse(ok).success).toBe(true);
    expect(
      AuthUserResponseSchema.safeParse({ ...ok, user: { email: 'a@vu.lt', role: 'root' } }).success
    ).toBe(false);
  });

  it('an error may carry a known code', () => {
    const error = { success: false, error: 'Wrong email or password.' };
    expect(AuthErrorResponseSchema.safeParse(error).success).toBe(true);
    expect(
      AuthErrorResponseSchema.safeParse({ ...error, code: 'invalid_credentials' }).success
    ).toBe(true);
    expect(AuthErrorResponseSchema.safeParse({ ...error, code: 'whatever' }).success).toBe(false);
  });
});
