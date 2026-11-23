const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How many emails the server may send in an hour, all kinds together (MAIL_PER_HOUR): the mail
// provider has a quota, and one object is shared by everything that sends. In memory, a
// restart forgets it.
export class HourlyQuota {
  private readonly times: number[] = [];

  constructor(readonly limit: number) {}

  full(now: number): boolean {
    while (this.times.length > 0 && now - this.times[0]! >= HOUR) this.times.shift();
    return this.times.length >= this.limit;
  }

  record(now: number): void {
    this.times.push(now);
  }

  // Takes back a record() whose email was not sent.
  release(time: number): void {
    const i = this.times.lastIndexOf(time);
    if (i >= 0) this.times.splice(i, 1);
  }
}

// In-memory email limits for one kind of email (the waitlist, the accounts): how often one
// address may get one, on top of the hourly quota. Stops anyone from flooding a stranger's
// mailbox through our forms. A restart forgets them.
export class EmailBudget {
  private readonly quota: HourlyQuota;
  private readonly perAddress = new Map<string, number[]>();
  private lastPrune = 0;

  constructor(
    private readonly emailIntervalMs: number,
    private readonly emailsPerAddressPerDay: number,
    // A number is a quota of its own, an HourlyQuota is shared with other budgets
    emailsPerHour: number | HourlyQuota
  ) {
    this.quota = typeof emailsPerHour === 'number' ? new HourlyQuota(emailsPerHour) : emailsPerHour;
  }

  // 'address': this address got enough emails, skip quietly (the answer must not differ).
  // 'global': the hourly quota is used up, the user is asked to try later.
  check(email: string, now: number): 'ok' | 'address' | 'global' {
    this.prune(now);
    const times = (this.perAddress.get(email) ?? []).filter((t) => now - t < DAY);
    const last = times[times.length - 1];
    if (last !== undefined && now - last < this.emailIntervalMs) return 'address';
    if (times.length >= this.emailsPerAddressPerDay) return 'address';
    if (this.quota.full(now)) return 'global';
    return 'ok';
  }

  record(email: string, now: number): void {
    this.quota.record(now);
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
    this.quota.release(time);
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
