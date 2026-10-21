import { toWire, type PixelEvent, type ServerMessage } from '../shared/protocol.ts';
import type { EventLog } from './event-log.ts';

export interface HubOptions {
  /** How often new events are sent out, in ms. */
  batchMs: number;
  /** How often push connections get a keep-alive message, in ms. */
  heartbeatMs: number;
  /** A client that missed more events than this reloads the snapshot instead of catching up. */
  maxBacklog: number;
}

/** A long-lived push connection: a WebSocket or an SSE stream. */
export interface PushClient {
  readonly kind: 'ws' | 'sse';
  /** `lastId` is the id of the last event in `payload` when it carries events. */
  send(payload: string, lastId?: number): void;
  /** Drops the connection; the client reconnects and catches up by itself. */
  close(): void;
}

/** A long-poll request parked until the next batch. */
export interface Waiter {
  wake(): void;
  close(): void;
}

/** Flushed events a client is missing, `null` if none, 'reset' if it must reload the snapshot. */
export type CatchUp = { payload: string; toId: number } | 'reset' | null;

export const RESET = encode({ t: 'reset' });
export const HEARTBEAT = encode({ t: 'hb' });
export const EMPTY_BATCH = encodeBatch([]);

export function encodeBatch(events: PixelEvent[]): string {
  return encode({ t: 'batch', events: events.map(toWire) });
}

function encode(message: ServerMessage): string {
  // No spaces and no newlines: SSE needs the whole message on one `data:` line.
  return JSON.stringify(message);
}

/**
 * Fans new events out to every connection, whatever the transport. Events are collected for
 * `batchMs` and serialised once per batch, not once per client.
 */
export class Hub {
  /** Id of the last event sent out. Later events wait in the log for the next batch. */
  flushedId = 0;
  private readonly log: EventLog;
  private readonly options: HubOptions;
  private readonly clients = new Set<PushClient>();
  private readonly waiters = new Set<Waiter>();
  private lastBatch: { afterId: number; payload: string } | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(log: EventLog, options: HubOptions) {
    this.log = log;
    this.options = options;
  }

  start(): void {
    this.timers = [
      setInterval(() => this.flush(), this.options.batchMs),
      setInterval(() => this.heartbeat(), this.options.heartbeatMs),
    ];
  }

  close(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.dropAll();
  }

  /** What a client that has every event up to `afterId` is missing right now. */
  catchUp(afterId: number): CatchUp {
    // An id this server never issued: it restarted and lost its in-memory log.
    if (afterId < 0 || afterId > this.log.lastId) return 'reset';
    // Up to date, or ahead of the last batch (its snapshot is newer): the next batch covers it.
    if (afterId >= this.flushedId) return null;
    if (this.flushedId - afterId > this.options.maxBacklog) return 'reset';
    // The common case for long polling: the client got the previous batch and waits for this one.
    if (this.lastBatch?.afterId === afterId) {
      return { payload: this.lastBatch.payload, toId: this.flushedId };
    }
    return { payload: encodeBatch(this.log.range(afterId, this.flushedId)), toId: this.flushedId };
  }

  /** Sends the client what it missed, then every following batch. */
  connect(client: PushClient, afterId: number): void {
    const missed = this.catchUp(afterId);
    if (missed === 'reset') client.send(RESET);
    else if (missed !== null) client.send(missed.payload, missed.toId);
    this.clients.add(client);
  }

  disconnect(client: PushClient): void {
    this.clients.delete(client);
  }

  wait(waiter: Waiter): void {
    this.waiters.add(waiter);
  }

  unwait(waiter: Waiter): void {
    this.waiters.delete(waiter);
  }

  flush(): void {
    const toId = this.log.lastId;
    if (toId === this.flushedId) return;
    const afterId = this.flushedId;
    const payload = encodeBatch(this.log.range(afterId, toId));
    this.flushedId = toId;
    this.lastBatch = { afterId, payload };

    for (const client of this.clients) client.send(payload, toId);
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const waiter of waiters) waiter.wake();
  }

  /** Simulates a network failure for everyone: every client has to reconnect. */
  dropAll(): void {
    for (const client of [...this.clients]) client.close();
    for (const waiter of [...this.waiters]) waiter.close();
    this.clients.clear();
    this.waiters.clear();
  }

  counts(): { ws: number; sse: number; lp: number } {
    const counts = { ws: 0, sse: 0, lp: this.waiters.size };
    for (const client of this.clients) counts[client.kind]++;
    return counts;
  }

  private heartbeat(): void {
    for (const client of this.clients) client.send(HEARTBEAT);
  }
}
