import { createHash, randomBytes } from 'node:crypto';

// Session tokens (in the cookie) and email tokens (in the links) are 32 random bytes as
// base64url, 43 characters. The database keeps only their SHA-256: whoever reads a copy of the
// database cannot sign in or use a link with it. A fast hash is enough here, unlike for
// passwords: a random token cannot be guessed.

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
