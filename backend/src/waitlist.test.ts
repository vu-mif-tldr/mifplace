import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS_DIR, MifDb, loadMigrations, migrate } from '@mifplace/db';
import { createApp } from './app.js';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import {
  ConsoleMailer,
  mailerFromEnv,
  SmtpMailer,
  smtpTransportOptions,
  type Mail,
  type Mailer,
} from './mailer.js';
import { EmailBudget, type WaitlistOptions, type WaitlistStore } from './waitlist.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

let server: Server | undefined;
let mif: MifDb | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
  mif?.close();
  mif = undefined;
});

interface Setup {
  url: string;
  mailer: ConsoleMailer;
  db: MifDb;
  clock: { now: number };
}

// A real MifDb on an in-memory database, a ConsoleMailer that keeps the emails and a clock
// the test moves by hand.
async function start(
  options: Partial<WaitlistOptions> = {},
  mailer: Mailer = new ConsoleMailer(() => {}),
  trustProxy: string | boolean = false
): Promise<Setup> {
  const db = new Database(':memory:');
  migrate(db, loadMigrations(MIGRATIONS_DIR));
  mif = new MifDb(db);
  const clock = { now: 1_000_000_000_000 };
  const app = createApp({
    canvasSize: { width: 4, height: 4 },
    palette: [{ id: 0, color: '#000000' }],
    checkHealth: () => {},
    getCanvasState: () => ({ pixels: [], eventId: 0, timestamp: 0 }),
    appendEvent: () => 1,
    trustProxy,
    waitlist: {
      store: mif,
      mailer,
      publicUrl: 'https://vu.place/',
      now: () => clock.now,
      ...options,
    },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server!.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/waitlist`,
    mailer: mailer as ConsoleMailer,
    db: mif,
    clock,
  };
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // A body that is not a JSON object fails in express.json(), which answers with an HTML page
  const json = res.headers.get('content-type')?.includes('json');
  const parsed = json ? ((await res.json()) as { success: boolean; error?: string }) : undefined;
  return { status: res.status, body: parsed ?? { success: false } };
}

function tokenOf(mail: Mail): string {
  const match = /confirm\.html\?t=([A-Za-z0-9_-]+)/.exec(mail.text);
  assert.ok(match, mail.text);
  return match[1]!;
}

describe('POST /api/waitlist', () => {
  it('sends a confirmation email with confirm and unsubscribe links', async () => {
    const { url, mailer } = await start();
    const res = await post(url, { email: '  Jonas@MIF.stud.vu.lt ' });
    assert.deepEqual(res, { status: 202, body: { success: true } });

    assert.equal(mailer.sent.length, 1);
    const mail = mailer.sent[0]!;
    assert.equal(mail.to, 'jonas@mif.stud.vu.lt');
    const token = tokenOf(mail);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    // The trailing slash of publicUrl does not double
    assert.ok(mail.text.includes(`https://vu.place/confirm.html?t=${token}`));
    assert.ok(mail.html.includes(`https://vu.place/confirm.html?t=${token}`));
    assert.equal(mail.unsubscribeUrl, `https://vu.place/unsubscribe.html?t=${token}`);
  });

  it('rejects other domains and broken bodies with 400', async () => {
    const { url, mailer } = await start();
    for (const body of [{ email: 'a@gmail.com' }, { email: 'not an email' }, {}, 'a@vu.lt']) {
      const res = await post(url, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.success, false);
    }
    assert.equal(mailer.sent.length, 0);
  });

  it('answers the same for a confirmed address and sends nothing', async () => {
    const { url, mailer } = await start();
    await post(url, { email: 'a@vu.lt' });
    const confirm = await post(`${url}/confirm`, { token: tokenOf(mailer.sent[0]!) });
    assert.equal(confirm.status, 200);

    const again = await post(url, { email: 'a@vu.lt' });
    assert.deepEqual(again, { status: 202, body: { success: true } });
    assert.equal(mailer.sent.length, 1);
  });

  it('resends the same link at most every 10 minutes and 3 times a day', async () => {
    const { url, mailer, clock } = await start();
    await post(url, { email: 'a@vu.lt' });
    // Too soon: same answer, no email
    clock.now += 5 * MINUTE;
    assert.equal((await post(url, { email: 'a@vu.lt' })).status, 202);
    assert.equal(mailer.sent.length, 1);

    clock.now += 6 * MINUTE;
    await post(url, { email: 'a@vu.lt' });
    clock.now += 11 * MINUTE;
    await post(url, { email: 'a@vu.lt' });
    assert.equal(mailer.sent.length, 3);
    assert.equal(tokenOf(mailer.sent[2]!), tokenOf(mailer.sent[0]!));

    // Fourth within a day: skipped
    clock.now += 11 * MINUTE;
    assert.equal((await post(url, { email: 'a@vu.lt' })).status, 202);
    assert.equal(mailer.sent.length, 3);

    // Next day it works again
    clock.now += 24 * HOUR;
    await post(url, { email: 'a@vu.lt' });
    assert.equal(mailer.sent.length, 4);
  });

  it('answers 503 when the hourly email quota is used up', async () => {
    const { url, mailer, clock } = await start({ emailsPerHour: 2 });
    await post(url, { email: 'a@vu.lt' });
    await post(url, { email: 'b@vu.lt' });
    const third = await post(url, { email: 'c@vu.lt' });
    assert.equal(third.status, 503);
    assert.equal(mailer.sent.length, 2);

    clock.now += HOUR;
    assert.equal((await post(url, { email: 'c@vu.lt' })).status, 202);
    assert.equal(mailer.sent.length, 3);
  });

  it('answers 503 when the email cannot be sent', async () => {
    const failing: Mailer = { send: () => Promise.reject(new Error('SMTP down')) };
    const { url } = await start({}, failing);
    const res = await post(url, { email: 'a@vu.lt' });
    assert.equal(res.status, 503);
    assert.match(res.body.error ?? '', /could not send/i);
  });

  it('does not count a failed email, so an immediate retry sends', async () => {
    let fail = true;
    const sent: Mail[] = [];
    const flaky: Mailer = {
      send: (mail) => {
        if (fail) return Promise.reject(new Error('SMTP down'));
        sent.push(mail);
        return Promise.resolve();
      },
    };
    const { url } = await start({ emailsPerHour: 1 }, flaky);
    assert.equal((await post(url, { email: 'a@vu.lt' })).status, 503);
    fail = false;
    assert.equal((await post(url, { email: 'a@vu.lt' })).status, 202);
    assert.equal(sent.length, 1);
  });

  it('answers 500 without details when the database fails, and sends nothing', async () => {
    const broken: WaitlistStore = {
      addToWaitlist: () => {
        throw new Error('disk I/O error');
      },
      confirmWaitlist: () => {
        throw new Error('disk I/O error');
      },
      removeFromWaitlist: () => {
        throw new Error('disk I/O error');
      },
    };
    const { url, mailer } = await start({ store: broken });
    const token = 'A'.repeat(43);
    for (const [path, body] of [
      ['', { email: 'a@vu.lt' }],
      ['/confirm', { token }],
      ['/unsubscribe', { token }],
    ] as const) {
      assert.deepEqual(await post(`${url}${path}`, body), {
        status: 500,
        body: { success: false, error: 'Internal server error' },
      });
    }
    assert.equal(mailer.sent.length, 0);
  });

  it('limits signups per IP', async () => {
    const { url } = await start({ signupsPerIpPerHour: 2 });
    assert.equal((await post(url, { email: 'a@vu.lt' })).status, 202);
    assert.equal((await post(url, { email: 'b@vu.lt' })).status, 202);
    assert.equal((await post(url, { email: 'c@vu.lt' })).status, 429);
  });
});

describe('client IP behind a proxy', () => {
  async function postFrom(url: string, ip: string, email: string) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ email }),
    });
    return res.status;
  }

  it('limits each forwarded client separately when the proxy is trusted', async () => {
    const { url } = await start({ signupsPerIpPerHour: 1 }, undefined, 'loopback');
    assert.equal(await postFrom(url, '203.0.113.1', 'a@vu.lt'), 202);
    assert.equal(await postFrom(url, '203.0.113.2', 'b@vu.lt'), 202);
    assert.equal(await postFrom(url, '203.0.113.1', 'c@vu.lt'), 429);
  });

  it('ignores X-Forwarded-For without TRUST_PROXY', async () => {
    const { url } = await start({ signupsPerIpPerHour: 1 });
    assert.equal(await postFrom(url, '203.0.113.1', 'a@vu.lt'), 202);
    assert.equal(await postFrom(url, '203.0.113.2', 'b@vu.lt'), 429);
  });
});

describe('POST /api/waitlist/confirm', () => {
  it('confirms by token, twice is fine', async () => {
    const { url, mailer } = await start();
    await post(url, { email: 'a@vu.lt' });
    const token = tokenOf(mailer.sent[0]!);
    assert.deepEqual(await post(`${url}/confirm`, { token }), {
      status: 200,
      body: { success: true },
    });
    assert.equal((await post(`${url}/confirm`, { token })).status, 200);
  });

  it('answers 404 for an unknown or expired link and 400 for a malformed one', async () => {
    const { url, mailer, clock } = await start();
    assert.equal((await post(`${url}/confirm`, { token: 'x'.repeat(43) })).status, 404);
    assert.equal((await post(`${url}/confirm`, { token: 'short' })).status, 400);
    assert.equal((await post(`${url}/confirm`, {})).status, 400);

    await post(url, { email: 'a@vu.lt' });
    clock.now += 8 * 24 * HOUR;
    const res = await post(`${url}/confirm`, { token: tokenOf(mailer.sent[0]!) });
    assert.equal(res.status, 404);
    assert.match(res.body.error ?? '', /expired/);
  });
});

describe('POST /api/waitlist/unsubscribe', () => {
  it('deletes the address, also a confirmed one; repeating is fine', async () => {
    const { url, mailer, db } = await start();
    await post(url, { email: 'a@vu.lt' });
    const token = tokenOf(mailer.sent[0]!);
    await post(`${url}/confirm`, { token });

    assert.deepEqual(await post(`${url}/unsubscribe`, { token }), {
      status: 200,
      body: { success: true },
    });
    assert.equal(db.removeFromWaitlist(token), false);
    assert.equal((await post(`${url}/unsubscribe`, { token })).status, 200);
    assert.equal((await post(`${url}/unsubscribe`, { token: 'bad' })).status, 400);
  });
});

describe('createApp without waitlist', () => {
  it('has no waitlist routes', async () => {
    const app = createApp({
      canvasSize: { width: 4, height: 4 },
      palette: [{ id: 0, color: '#000000' }],
      checkHealth: () => {},
      getCanvasState: () => ({ pixels: [], eventId: 0, timestamp: 0 }),
      appendEvent: () => 1,
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server!.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/waitlist`, { method: 'POST' });
    assert.equal(res.status, 404);
  });
});

describe('EmailBudget', () => {
  it('forgets addresses after a day', () => {
    const budget = new EmailBudget(10 * MINUTE, 1, 100);
    budget.record('a@vu.lt', 0);
    assert.equal(budget.check('a@vu.lt', 20 * MINUTE), 'address');
    assert.equal(budget.check('a@vu.lt', 24 * HOUR), 'ok');
  });
});

describe('EmailBudget.release', () => {
  it('ignores what was never recorded and keeps other records', () => {
    const budget = new EmailBudget(10 * MINUTE, 3, 1);
    budget.release('a@vu.lt', 0);
    budget.record('a@vu.lt', 0);
    budget.release('b@vu.lt', 0);
    budget.release('a@vu.lt', 5);
    // a@vu.lt is still counted, and so is the one email of the hourly quota
    assert.equal(budget.check('a@vu.lt', MINUTE), 'address');
    assert.equal(budget.check('c@vu.lt', MINUTE), 'global');
    budget.release('a@vu.lt', 0);
    assert.equal(budget.check('a@vu.lt', MINUTE), 'ok');
  });
});

describe('SmtpMailer', () => {
  const config = { host: 'smtp.example.com', port: 587, from: 'vu.place <noreply@vu.place>' };

  // nodemailer's JSON transport builds the message without a server, sendMail returns it.
  function jsonMailer() {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const messages: Record<string, unknown>[] = [];
    const sendMail = transport.sendMail.bind(transport);
    transport.sendMail = (async (options: SendMailOptions) => {
      const info = await sendMail(options);
      messages.push(JSON.parse(info.message as unknown as string) as Record<string, unknown>);
      return info;
    }) as typeof transport.sendMail;
    return { mailer: new SmtpMailer(config, transport), messages };
  }

  it('sends from MAIL_FROM with both bodies and the List-Unsubscribe header', async () => {
    const { mailer, messages } = jsonMailer();
    await mailer.send({
      to: 'a@vu.lt',
      subject: 'Hi',
      text: 'plain',
      html: '<p>html</p>',
      unsubscribeUrl: 'https://vu.place/unsubscribe.html?t=abc',
    });
    const message = messages[0]!;
    assert.deepEqual(message.from, { address: 'noreply@vu.place', name: 'vu.place' });
    assert.deepEqual(message.to, [{ address: 'a@vu.lt', name: '' }]);
    assert.equal(message.subject, 'Hi');
    assert.equal(message.text, 'plain');
    assert.equal(message.html, '<p>html</p>');
    assert.deepEqual(message.list, { unsubscribe: 'https://vu.place/unsubscribe.html?t=abc' });
  });

  it('has no List-Unsubscribe header without an unsubscribe link', async () => {
    const { mailer, messages } = jsonMailer();
    await mailer.send({ to: 'a@vu.lt', subject: 'Hi', text: 'plain', html: '<p>html</p>' });
    assert.equal(messages[0]!.list, undefined);
  });

  it('uses TLS on 465, STARTTLS elsewhere, and logs in only with a user', () => {
    assert.deepEqual(smtpTransportOptions(config), {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: undefined,
    });
    const tls = smtpTransportOptions({ ...config, port: 465, user: 'u', pass: 'p' });
    assert.equal(tls.secure, true);
    assert.equal(tls.requireTLS, false);
    assert.deepEqual(tls.auth, { user: 'u', pass: 'p' });
  });
});

describe('mailerFromEnv', () => {
  it('prints emails in development and refuses to start without SMTP in production', () => {
    assert.ok(mailerFromEnv({}) instanceof ConsoleMailer);
    assert.throws(() => mailerFromEnv({ NODE_ENV: 'production' }), /SMTP_HOST must be set/);
  });

  it('builds an SMTP mailer and checks its settings', () => {
    const env = { SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'vu.place <noreply@vu.place>' };
    assert.ok(mailerFromEnv(env) instanceof SmtpMailer);
    assert.throws(() => mailerFromEnv({ SMTP_HOST: 'smtp.example.com' }), /MAIL_FROM/);
    assert.throws(() => mailerFromEnv({ ...env, SMTP_PORT: 'abc' }), /Invalid SMTP_PORT/);
  });
});
