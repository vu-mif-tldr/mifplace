import {
  formatCursor,
  toWire,
  type Cursor,
  type PixelEvent,
  type ServerMessage,
} from '../shared/protocol.ts';
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
  /** `cursor` is the cursor of the last event in `payload` when it carries events. */
  send(payload: string, cursor?: string): void;
  /** Drops the connection; the client reconnects and catches up by itself. */
  close(): void;
}

/** A long-poll request parked until the next batch. */
export interface Waiter {
  wake(): void;
  close(): void;
}

/** Flushed events a client is missing, `null` if none, 'reset' if it must reload the snapshot. */
export type CatchUp = { payload: string; cursor: string } | 'reset' | null;

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
  flushedId: number;
  /** Since the start, for the load tests. The transports and the app add to them too. */
  readonly counters = {
    batches: 0,
    messages: 0,
    /** Disconnected because too much unsent data piled up for them. */
    slowClientsDropped: 0,
    /** WebSockets terminated because they did not answer a ping. */
    pingTimeouts: 0,
    /** Requests that failed with a 500. */
    errors: 0,
  };
  private readonly log: EventLog;
  private readonly options: HubOptions;
  private readonly clients = new Set<PushClient>();
  private readonly waiters = new Set<Waiter>();
  private lastBatch: { afterId: number; payload: string } | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(log: EventLog, options: HubOptions) {
    this.log = log;
    this.options = options;
    // Events read back from a file after a restart count as sent: clients that miss some of them
    // catch up from their cursor. Starting from 0 made the first batch the whole log, for everyone.
    this.flushedId = log.lastId;
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

  /** What a client at `cursor` is missing right now. `null` = a malformed cursor. */
  catchUp(cursor: Cursor | null): CatchUp {
    if (cursor === null || cursor.id > this.log.lastId) return 'reset';
    // The id exists here, but for another event: the log was lost or restored since the client
    // got it. Continuing would silently mix two logs.
    if (this.log.tsOf(cursor.id) !== cursor.ts) return 'reset';
    // Up to date, or ahead of the last batch (its snapshot is newer): the next batch covers it.
    if (cursor.id >= this.flushedId) return null;
    if (this.flushedId - cursor.id > this.options.maxBacklog) return 'reset';
    const toCursor = this.cursorAt(this.flushedId);
    // The common case for long polling: the client got the previous batch and waits for this one.
    if (this.lastBatch?.afterId === cursor.id) {
      return { payload: this.lastBatch.payload, cursor: toCursor };
    }
    return { payload: encodeBatch(this.log.range(cursor.id, this.flushedId)), cursor: toCursor };
  }

  /** Sends the client what it missed, then every following batch. */
  connect(client: PushClient, cursor: Cursor | null): void {
    const missed = this.catchUp(cursor);
    if (missed === 'reset') client.send(RESET);
    else if (missed !== null) client.send(missed.payload, missed.cursor);
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

    const cursor = this.cursorAt(toId);
    for (const client of this.clients) client.send(payload, cursor);
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const waiter of waiters) waiter.wake();
    this.counters.batches++;
    this.counters.messages += this.clients.size + waiters.length;
  }

  /** Simulates a network failure for everyone: every client has to reconnect. */
  dropAll(): void {
    for (const client of [...this.clients]) client.close();
    for (const waiter of [...this.waiters]) waiter.close();
    this.clients.clear();
    this.waiters.clear();
  }

  /** Simulates network failures for `count` random connections (test T3). Returns how many. */
  dropRandom(count: number): number {
    const connections = [...this.clients, ...this.waiters];
    const dropped = Math.min(count, connections.length);
    // A partial Fisher-Yates shuffle: the first `dropped` entries are a random sample.
    for (let i = 0; i < dropped; i++) {
      const j = i + Math.floor(Math.random() * (connections.length - i));
      [connections[i], connections[j]] = [connections[j], connections[i]];
      const connection = connections[i];
      connection.close();
      if ('send' in connection) this.clients.delete(connection);
      else this.waiters.delete(connection);
    }
    return dropped;
  }

  counts(): { ws: number; sse: number; lp: number } {
    const counts = { ws: 0, sse: 0, lp: this.waiters.size };
    for (const client of this.clients) counts[client.kind]++;
    return counts;
  }

  private cursorAt(id: number): string {
    return formatCursor({ id, ts: this.log.tsOf(id) ?? 0 });
  }

  private heartbeat(): void {
    for (const client of this.clients) client.send(HEARTBEAT);
    this.counters.messages += this.clients.size;
  }
}
