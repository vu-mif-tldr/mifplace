import { encodeOnline } from './protocol.js';

// Tells every page how many pages are connected (docs/api.md, "online"). The count changes on
// every connect and close; at most one message per intervalMs goes out, and only when the count
// differs from the last one sent, so a wave of reconnects after a restart is one message, not
// thousands. A new page gets the count at once from the live server, not from here.
export class OnlineAnnouncer {
  private timer: NodeJS.Timeout | undefined;
  private lastSent: number | undefined;
  private closed = false;

  constructor(
    private readonly options: { intervalMs: number },
    // The open connections now
    private readonly count: () => number,
    // registry.broadcast in production, a fake in tests
    private readonly send: (data: string) => void
  ) {}

  // A page connected or left: the count goes out within intervalMs
  changed(): void {
    if (this.closed || this.timer !== undefined) return;
    this.timer = setTimeout(() => this.flush(), this.options.intervalMs);
  }

  private flush(): void {
    this.timer = undefined;
    const count = this.count();
    if (count === this.lastSent) return;
    this.lastSent = count;
    this.send(encodeOnline(count));
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
