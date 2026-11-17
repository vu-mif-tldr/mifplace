import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { EmailBudget, HourlyQuota } from '../email-budget.js';
import { isAllowedOrigin } from '../origin.js';
import { emailDomainsFromEnv } from './config.js';
import { alreadyRegisteredEmail, passwordResetEmail, verificationEmail } from './emails.js';
import { readCookie } from './sessions.js';
import { FailureThrottle } from './throttle.js';
import { TOKEN_PATTERN, hashToken, newToken } from './tokens.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe('tokens', () => {
  it('are random, 43 base64url characters, and hash to 64 hex characters', () => {
    const a = newToken();
    const b = newToken();
    assert.notEqual(a, b);
    assert.match(a, TOKEN_PATTERN);
    assert.match(hashToken(a), /^[0-9a-f]{64}$/);
    assert.equal(hashToken(a), hashToken(a));
    assert.notEqual(hashToken(a), hashToken(b));
  });
});

describe('readCookie', () => {
  it('finds one cookie among others', () => {
    assert.equal(readCookie('session=abc', 'session'), 'abc');
    assert.equal(readCookie('theme=dark; session=abc; x=1', 'session'), 'abc');
    assert.equal(readCookie('theme=dark;session=a=b', 'session'), 'a=b');
    assert.equal(readCookie('xsession=abc', 'session'), undefined);
    assert.equal(readCookie('session', 'session'), undefined);
    assert.equal(readCookie('', 'session'), undefined);
    assert.equal(readCookie(undefined, 'session'), undefined);
  });
});

describe('FailureThrottle', () => {
  it('blocks a key after max failures until they leave the window', () => {
    const throttle = new FailureThrottle(2, 10 * MINUTE);
    assert.equal(throttle.blocked('a', 0), false);
    throttle.fail('a', 0);
    throttle.fail('a', 5 * MINUTE);
    assert.equal(throttle.blocked('a', 6 * MINUTE), true);
    assert.equal(throttle.blocked('b', 6 * MINUTE), false);
    // The first failure is 10 minutes old: one left in the window
    assert.equal(throttle.blocked('a', 10 * MINUTE), false);
    throttle.fail('a', 10 * MINUTE);
    assert.equal(throttle.blocked('a', 11 * MINUTE), true);
    throttle.clear('a');
    assert.equal(throttle.blocked('a', 11 * MINUTE), false);
  });

  it('takes back one counted attempt, not the others', () => {
    const throttle = new FailureThrottle(2, 10 * MINUTE);
    throttle.fail('a', 0);
    throttle.fail('a', MINUTE);
    throttle.undo('a', MINUTE);
    throttle.undo('a', 5 * MINUTE); // never counted
    throttle.undo('b', 0);
    assert.equal(throttle.blocked('a', 2 * MINUTE), false);
    throttle.fail('a', 2 * MINUTE);
    assert.equal(throttle.blocked('a', 3 * MINUTE), true);
  });

  it('forgets keys without recent failures', () => {
    const throttle = new FailureThrottle(1, MINUTE);
    throttle.fail('a', 0);
    throttle.fail('b', 20 * MINUTE);
    assert.equal(throttle.blocked('b', 20 * MINUTE), true);
    assert.equal(throttle.blocked('a', 20 * MINUTE), false);
  });
});

describe('HourlyQuota', () => {
  it('is shared by the budgets that are given it', () => {
    const quota = new HourlyQuota(2);
    const waitlist = new EmailBudget(10 * MINUTE, 3, quota);
    const accounts = new EmailBudget(MINUTE, 5, quota);
    waitlist.record('a@vu.lt', 0);
    accounts.record('b@vu.lt', 0);
    assert.equal(waitlist.check('c@vu.lt', MINUTE), 'global');
    assert.equal(accounts.check('c@vu.lt', MINUTE), 'global');
    // An email that was not sent gives its place back to both
    accounts.release('b@vu.lt', 0);
    assert.equal(waitlist.check('c@vu.lt', MINUTE), 'ok');
    assert.equal(accounts.check('c@vu.lt', HOUR), 'ok');
  });
});

describe('isAllowedOrigin', () => {
  it('allows no Origin, the own host and the listed origins', () => {
    assert.equal(isAllowedOrigin(undefined, 'vu.place', []), true);
    assert.equal(isAllowedOrigin('https://vu.place', 'vu.place', []), true);
    assert.equal(isAllowedOrigin('https://VU.place', 'vu.place', []), true);
    assert.equal(isAllowedOrigin('http://localhost:5173', 'localhost:3000', []), false);
    assert.equal(
      isAllowedOrigin('http://localhost:5173', 'localhost:3000', ['http://localhost:5173/']),
      true
    );
  });

  it('refuses other sites and broken values', () => {
    assert.equal(isAllowedOrigin('https://evil.example', 'vu.place', []), false);
    assert.equal(isAllowedOrigin('https://vu.place.evil.example', 'vu.place', []), false);
    assert.equal(isAllowedOrigin('https://vu.place', undefined, []), false);
    assert.equal(isAllowedOrigin('null', 'vu.place', []), false);
    assert.equal(isAllowedOrigin('ftp://vu.place', 'vu.place', []), false);
    assert.equal(isAllowedOrigin('https://user@vu.place', 'vu.place', []), false);
    assert.equal(isAllowedOrigin('https://vu.place/path', 'vu.place', []), false);
    assert.equal(isAllowedOrigin('https://evil.example', 'vu.place', ['not a url']), false);
  });
});

describe('emailDomainsFromEnv', () => {
  it('defaults to vu.lt and reads a comma-separated list', () => {
    assert.deepEqual(emailDomainsFromEnv({}), ['vu.lt']);
    assert.deepEqual(emailDomainsFromEnv({ ALLOWED_EMAIL_DOMAINS: ' ' }), ['vu.lt']);
    assert.deepEqual(emailDomainsFromEnv({ ALLOWED_EMAIL_DOMAINS: 'VU.lt, example.org' }), [
      'vu.lt',
      'example.org',
    ]);
  });

  it('stops at start on something that is not a domain', () => {
    for (const value of ['vu', '@vu.lt', 'vu.lt,', '*.vu.lt', 'vu.lt example.org']) {
      assert.throws(
        () => emailDomainsFromEnv({ ALLOWED_EMAIL_DOMAINS: value }),
        /Invalid ALLOWED_EMAIL_DOMAINS/,
        value
      );
    }
  });
});

describe('emails', () => {
  const token = 'A'.repeat(43);

  it('link to the page with the token after #, in the text and in the HTML', () => {
    const verify = verificationEmail('a@vu.lt', 'https://vu.place/', token);
    assert.equal(verify.to, 'a@vu.lt');
    assert.ok(verify.text.includes(`https://vu.place/#/verify/${token}`));
    assert.ok(verify.html.includes(`href="https://vu.place/#/verify/${token}"`));

    const reset = passwordResetEmail('a@vu.lt', 'https://vu.place', token);
    assert.ok(reset.text.includes(`https://vu.place/#/reset/${token}`));
    assert.ok(reset.html.includes(`href="https://vu.place/#/reset/${token}"`));
  });

  it('the "already registered" email has no token', () => {
    const mail = alreadyRegisteredEmail('a@vu.lt', 'https://vu.place/');
    assert.ok(mail.text.includes('https://vu.place'));
    assert.doesNotMatch(mail.text + mail.html, /#\//);
  });
});
