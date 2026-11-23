import type { Mail } from '../mailer.js';

// The emails of the accounts. The links point to the page itself with the token after "#":
// that part of a URL is never sent to a server, so the token does not end up in access logs.
// Opening a link does nothing yet; the page has a button that sends the token with a POST,
// because mail scanners (Outlook Safe Links) open every link in an email.

const SIGNATURE = 'Team TLDR, vu.place';

function link(publicUrl: string, action: 'verify' | 'reset', token: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/#/${action}/${token}`;
}

// The token is base64url and publicUrl comes from our own config, so the URLs need no escaping.
function html(paragraphs: string[]): string {
  return [
    ...paragraphs.map((p) => `<p>${p}</p>`),
    `<p style="color:#666;font-size:12px">${SIGNATURE}</p>`,
  ].join('\n');
}

// After registration: the address counts once its owner opens the link.
export function verificationEmail(email: string, publicUrl: string, token: string): Mail {
  const url = link(publicUrl, 'verify', token);
  return {
    to: email,
    subject: 'Confirm your email address for vu.place',
    text: [
      'Hi!',
      '',
      'Someone (hopefully you) registered on vu.place with this address.',
      'Confirm it here, the link works for 24 hours:',
      url,
      '',
      'If it was not you, just ignore this email: an unconfirmed account is deleted after a day.',
      '',
      SIGNATURE,
    ].join('\n'),
    html: html([
      'Hi!',
      'Someone (hopefully you) registered on vu.place with this address.',
      `<a href="${url}">Confirm my address</a> (the link works for 24 hours)`,
      'If it was not you, just ignore this email: an unconfirmed account is deleted after a day.',
    ]),
  };
}

// After "forgot my password".
export function passwordResetEmail(email: string, publicUrl: string, token: string): Mail {
  const url = link(publicUrl, 'reset', token);
  return {
    to: email,
    subject: 'Set a new password for vu.place',
    text: [
      'Hi!',
      '',
      'Someone (hopefully you) asked to set a new password for your vu.place account.',
      'Set it here, the link works for 1 hour:',
      url,
      '',
      'If it was not you, just ignore this email: your password stays as it is.',
      '',
      SIGNATURE,
    ].join('\n'),
    html: html([
      'Hi!',
      'Someone (hopefully you) asked to set a new password for your vu.place account.',
      `<a href="${url}">Set a new password</a> (the link works for 1 hour)`,
      'If it was not you, just ignore this email: your password stays as it is.',
    ]),
  };
}

// A registration with an address that already has an account. The form answers the same as
// for a new address, the owner learns about it here.
export function alreadyRegisteredEmail(email: string, publicUrl: string): Mail {
  const url = publicUrl.replace(/\/+$/, '');
  return {
    to: email,
    subject: 'You already have a vu.place account',
    text: [
      'Hi!',
      '',
      'Someone (hopefully you) tried to register on vu.place with this address, but it already',
      'has an account. Nothing was changed.',
      '',
      `Sign in here: ${url}`,
      'If you do not remember the password, choose "Forgot password" there.',
      '',
      SIGNATURE,
    ].join('\n'),
    html: html([
      'Hi!',
      'Someone (hopefully you) tried to register on vu.place with this address, but it already has an account. Nothing was changed.',
      `<a href="${url}">Sign in</a>. If you do not remember the password, choose "Forgot password" there.`,
    ]),
  };
}
