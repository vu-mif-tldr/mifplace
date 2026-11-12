import { encodePixels, type Checkpoint, type PixelEvent } from './protocol.js';

// A stored pixel as the live stream needs it: the event with the time it was written to the log
export type LiveEvent = PixelEvent & { timestamp: number };

// Collects the pixels stored since the last batch and sends them as one pixels message every
// batchMs (docs/api.md: 100 ms), serialised once for all clients, the sender included. Nothing
// is sent while nothing changed, there is no heartbeat message: connection health is ping/pong.
export class Broadcaster {
  private pending: LiveEvent[] = [];
  private timer: NodeJS.Timeout | undefined;
  private last: Checkpoint;
  private closed = false;

  constructor(
    private readonly options: { batchMs: number },
    // registry.broadcast in production, a fake in tests
    private readonly send: (data: string) => void,
    // The last stored event when the server starts
    lastSent: Checkpoint
  ) {
    this.last = lastSent;
  }

  // Events up to this one were sent, later ones are pending. Catch-up (MP-89) uses it to decide
  // which events a reconnecting client gets from the log and which come with the next batch.
  get lastSent(): Checkpoint {
    return this.last;
  }

  // Called right after the event is stored. The first publish after a batch starts the timer,
  // no timer runs while there is nothing to send.
  publish(event: LiveEvent): void {
    if (this.closed) return;
    this.pending.push(event);
    if (this.timer === undefined) {
      this.timer = setTimeout(() => this.flush(), this.options.batchMs);
    }
  }

  private flush(): void {
    this.timer = undefined;
    const events = this.pending;
    this.pending = [];
    // The timer only runs after a publish, so there is at least one event
    const { eventId, timestamp } = events[events.length - 1];
    this.last = { eventId, timestamp };
    this.send(encodePixels(events, this.last));
  }

  // Stops the timer; pending events are dropped, the server is shutting down
  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = [];
  }
}
