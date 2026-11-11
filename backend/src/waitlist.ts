import { randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  WaitlistSignupRequestSchema,
  WaitlistTokenRequestSchema,
  zodErrorMessage,
  type ErrorResponse,
} from '@mifplace/shared';
import type { Mailer } from './mailer.js';

// The waitlist on vu.place before launch: POST /api/waitlist (see docs/api.md).
// Double opt-in: a signup only sends a link, the address counts once the link is confirmed.

// What the router needs from the database (MifDb implements it), injected so tests need no DB.
export interface WaitlistStore {
  // Adds the address or returns the existing row; an existing row keeps its token.
  addToWaitlist(
    email: string,
    token: string,
    now: number
  ): { token: string; confirmed_at: number | null };
  confirmWaitlist(token: string, notBefore: number, now: number): boolean;
  removeFromWaitlist(token: string): boolean;
}

export interface WaitlistOptions {
  store: WaitlistStore;
  mailer: Mailer;
  // Where the landing pages are, e.g. https://vu.place; the email links point there.
  publicUrl: string;
  now?: () => number;
  // Signup requests per IP. Campus Wi-Fi and dorms share addresses, so it is generous:
  // the per-address and global email limits below are what protects the mail quota.
  signupsPerIpPerHour?: number;
  // Emails to one address: not more often than this, and not more than emailsPerAddressPerDay.
  // Stops anyone from flooding a stranger's mailbox through our form.
  emailIntervalMs?: number;
  emailsPerAddressPerDay?: number;
  // All emails together. The SendPulse free plan sends 50 per hour, we stay below it.
  emailsPerHour?: number;
  // A pending address must be confirmed within this time, later the link expires.
  confirmWithinMs?: number;
}

export type WaitlistResponse = { success: true };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How long a pending address may wait for confirmation; the server also deletes older ones on start.
export const CONFIRM_WITHIN_MS = 7 * DAY;

// In-memory email limits. A restart forgets them, which is fine for a waitlist.
export class EmailBudget {
  private readonly global: number[] = [];
  private readonly perAddress = new Map<string, number[]>();
  private lastPrune = 0;

  constructor(
    private readonly emailIntervalMs: number,
    private readonly emailsPerAddressPerDay: number,
    private readonly emailsPerHour: number
  ) {}

  // 'address': this address got enough emails, skip quietly (the answer must not differ).
  // 'global': the hourly quota is used up, the user is asked to try later.
  check(email: string, now: number): 'ok' | 'address' | 'global' {
    this.prune(now);
    const times = (this.perAddress.get(email) ?? []).filter((t) => now - t < DAY);
    const last = times[times.length - 1];
    if (last !== undefined && now - last < this.emailIntervalMs) return 'address';
    if (times.length >= this.emailsPerAddressPerDay) return 'address';
    while (this.global.length > 0 && now - this.global[0]! >= HOUR) this.global.shift();
    if (this.global.length >= this.emailsPerHour) return 'global';
    return 'ok';
  }

  record(email: string, now: number): void {
    this.global.push(now);
    const times = (this.perAddress.get(email) ?? []).filter((t) => now - t < DAY);
    times.push(now);
    this.perAddress.set(email, times);
  }

  // Takes back a record() whose email was not sent, so a retry is not counted against the limits.
  release(email: string, time: number): void {
    const times = this.perAddress.get(email);
    const i = times?.lastIndexOf(time) ?? -1;
    if (i < 0) return;
    times!.splice(i, 1);
    this.global.splice(this.global.lastIndexOf(time), 1);
  }

  // Drops addresses without emails in the last day, at most every 10 minutes.
  private prune(now: number): void {
    if (now - this.lastPrune < 10 * MINUTE) return;
    this.lastPrune = now;
    for (const [email, times] of this.perAddress) {
      if (times.every((t) => now - t >= DAY)) this.perAddress.delete(email);
    }
  }
}

export function confirmationEmail(email: string, publicUrl: string, token: string) {
  const base = publicUrl.replace(/\/+$/, '');
  const confirmUrl = `${base}/confirm.html?t=${token}`;
  const unsubscribeUrl = `${base}/unsubscribe.html?t=${token}`;
  const text = [
    'Hi!',
    '',
    'Someone (hopefully you) asked to join the vu.place waitlist with this address.',
    'Confirm it here:',
    confirmUrl,
    '',
    'If it was not you, just ignore this email: an unconfirmed address is deleted after 7 days.',
    '',
    `Remove your address: ${unsubscribeUrl}`,
    '',
    'Team TLDR, vu.place',
  ].join('\n');
  // The token is base64url and publicUrl comes from our own config, so the URLs need no escaping.
  const html = `<p>Hi!</p>
<p>Someone (hopefully you) asked to join the vu.place waitlist with this address.</p>
<p><a href="${confirmUrl}">Confirm my address</a></p>
<p>If it was not you, just ignore this email: an unconfirmed address is deleted after 7 days.</p>
<p style="color:#666;font-size:12px"><a href="${unsubscribeUrl}">Remove my address</a> · Team TLDR, vu.place</p>`;
  return {
    to: email,
    subject: 'Confirm your place on the vu.place waitlist',
    text,
    html,
    unsubscribeUrl,
  };
}

export function createWaitlistRouter({
  store,
  mailer,
  publicUrl,
  now = Date.now,
  signupsPerIpPerHour = 30,
  emailIntervalMs = 10 * MINUTE,
  emailsPerAddressPerDay = 3,
  emailsPerHour = 40,
  confirmWithinMs = CONFIRM_WITHIN_MS,
}: WaitlistOptions): Router {
  const router = Router();
  const budget = new EmailBudget(emailIntervalMs, emailsPerAddressPerDay, emailsPerHour);

  const signupLimiter = rateLimit({
    windowMs: HOUR,
    limit: signupsPerIpPerHour,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many signups from your network, please try later.' },
  });

  // 202 for a new, a pending and an already confirmed address alike: the form must not tell
  // who is on the list. Only a bad address (400) and a used-up mail quota (503) differ.
  router.post('/', signupLimiter, async (req, res: Response<WaitlistResponse | ErrorResponse>) => {
    const body = WaitlistSignupRequestSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ success: false, error: zodErrorMessage(body.error) });
    }
    const { email } = body.data;
    const time = now();
    console.log(`Waitlist signup request from ${req.ip}`);

    let row;
    try {
      row = store.addToWaitlist(email, randomBytes(32).toString('base64url'), time);
    } catch (error) {
      console.error('Waitlist insert failed:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
    if (row.confirmed_at !== null) return res.status(202).json({ success: true });

    const verdict = budget.check(email, time);
    if (verdict === 'address') return res.status(202).json({ success: true });
    if (verdict === 'global') {
      return res.status(503).json({
        success: false,
        error: 'Too many signups right now, please try again in an hour.',
      });
    }
    budget.record(email, time);
    try {
      await mailer.send(confirmationEmail(email, publicUrl, row.token));
    } catch (error) {
      console.error('Waitlist email failed:', error);
      budget.release(email, time);
      return res
        .status(503)
        .json({ success: false, error: 'Could not send the email, please try again later.' });
    }
    return res.status(202).json({ success: true });
  });

  router.post('/confirm', (req, res: Response<WaitlistResponse | ErrorResponse>) => {
    const body = WaitlistTokenRequestSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ success: false, error: zodErrorMessage(body.error) });
    }
    const time = now();
    try {
      if (store.confirmWaitlist(body.data.token, time - confirmWithinMs, time)) {
        return res.json({ success: true });
      }
    } catch (error) {
      console.error('Waitlist confirm failed:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
    return res.status(404).json({
      success: false,
      error: 'This link is unknown or has expired, please sign up again.',
    });
  });

  // Always 200 for a well-formed token: removing an address that is not there is not an error.
  router.post('/unsubscribe', (req, res: Response<WaitlistResponse | ErrorResponse>) => {
    const body = WaitlistTokenRequestSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ success: false, error: zodErrorMessage(body.error) });
    }
    try {
      store.removeFromWaitlist(body.data.token);
    } catch (error) {
      console.error('Waitlist unsubscribe failed:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
    return res.json({ success: true });
  });

  return router;
}
