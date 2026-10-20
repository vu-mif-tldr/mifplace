import type * as http from 'node:http';
import type * as stream from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { EventRow, MifDb } from '@mifplace/db';
import { logger } from '@mifplace/server-lib';
import { encodeEvents, encodeReload } from '@mifplace/shared';

const log = logger('ws');

// The messages are described in @mifplace/shared (live.ts).
export type LiveEvent = Pick<EventRow, 'id' | 'position' | 'color_id'>;

const RELOAD = encodeReload();

export interface LiveUpdatesOptions {
  // New events are collected and sent as one message at most this often.
  batchMs: number;
  // A client further behind than this gets RELOAD instead of the missed events.
  maxCatchUp: number;
  // A client that does not read its messages is dropped when this many bytes are queued.
  // It reconnects and catches up.
  maxBufferedBytes: number;
  // Connections that did not answer the previous ping are closed.
  pingMs: number;
}

// The server may override these with WS_* settings, see .env.example.
export const DEFAULT_LIVE_OPTIONS: LiveUpdatesOptions = {
  batchMs: 150,
  maxCatchUp: 10_000,
  maxBufferedBytes: 1024 * 1024,
  pingMs: 30_000,
};

// Pushes new events to the connected clients over WebSocket.
// A client loads GET /api/canvas, then connects to /api/ws?after=<last_event_id of the snapshot>.
// On connect it gets the events it missed, then every new event, in id order and without gaps.
// Everything runs synchronously on the event loop, so nothing is appended between the catch-up
// and the moment the client joins the broadcast.
export class LiveUpdates {
  private readonly options: LiveUpdatesOptions;
  private readonly wss: WebSocketServer;
  // Per connection: a number for the log, when it connected and whether it answered the ping.
  private readonly connections = new WeakMap<
    WebSocket,
    { id: number; since: number; alive: boolean }
  >();
  private connectionCount = 0;
  private readonly pingTimer: NodeJS.Timeout;
  private pending: LiveEvent[] = [];
  private flushTimer: NodeJS.Timeout | undefined;

  // lastEventId: the last event that is already in the database when the server starts.
  // Events up to lastSentId reach new clients from the database, later ones with the next
  // broadcast.
  constructor(
    private readonly mifDb: Pick<MifDb, 'getEventsAfter'>,
    private lastSentId: number,
    options: Partial<LiveUpdatesOptions> = {}
  ) {
    this.options = { ...DEFAULT_LIVE_OPTIONS, ...options };
    // No compression: messages are small and per-connection deflate costs CPU and memory.
    // Clients send nothing, so the payload limit is tiny.
    this.wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 });
    this.pingTimer = setInterval(() => this.ping(), this.options.pingMs);
  }

  // Called for every event right after it is stored.
  publish(event: LiveEvent): void {
    this.pending.push(event);
    this.flushTimer ??= setTimeout(() => this.flush(), this.options.batchMs);
  }

  // Takes over an HTTP upgrade request for /api/ws.
  handleUpgrade(req: http.IncomingMessage, socket: stream.Duplex, head: Buffer): void {
    // Only decimal digits: Number() would turn a missing or empty value into 0.
    const raw = new URL(req.url ?? '', 'http://localhost').searchParams.get('after') ?? '';
    const after = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(after)) {
      log.warn('connection rejected, bad after', { after: raw });
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.connect(ws, after));
  }

  get clientCount(): number {
    return this.wss.clients.size;
  }

  // Closes all connections, used on shutdown.
  close(): void {
    clearInterval(this.pingTimer);
    clearTimeout(this.flushTimer);
    for (const ws of this.wss.clients) ws.close(1001, 'Server is shutting down');
    this.wss.close();
  }

  private connect(ws: WebSocket, after: number): void {
    const connection = { id: ++this.connectionCount, since: Date.now(), alive: true };
    const { id } = connection;
    this.connections.set(ws, connection);
    ws.on('pong', () => (connection.alive = true));
    ws.on('error', (e) => {
      log.warn('socket error', { id, error: e.message });
      ws.terminate();
    });
    ws.on('close', (code) =>
      log.info('client disconnected', {
        id,
        code,
        seconds: Math.round((Date.now() - connection.since) / 1000),
        clients: this.clientCount,
      })
    );

    // An id from the future means the client saw another database (e.g. it was recreated).
    // Ids may have gaps, so the difference is an upper bound of the number of missed events.
    if (after > this.newestId() || this.lastSentId - after > this.options.maxCatchUp) {
      log.info('client told to reload', {
        id,
        after,
        lastEventId: this.newestId(),
        reason: after > this.newestId() ? 'unknown id' : 'too far behind',
      });
      this.send(ws, RELOAD);
      ws.close(1000, 'Reload the canvas');
      return;
    }
    // Events between lastSentId and after are pending, they come with the next broadcast
    // and the client skips them.
    let missed: LiveEvent[] = [];
    if (after < this.lastSentId) {
      missed = this.mifDb.getEventsAfter(after).filter((e) => e.id <= this.lastSentId);
      this.send(ws, encodeEvents(missed));
    }
    log.info('client connected', { id, after, missed: missed.length, clients: this.clientCount });
  }

  // The last event the server knows about, sent or pending.
  private newestId(): number {
    return this.pending.length > 0 ? this.pending[this.pending.length - 1].id : this.lastSentId;
  }

  private flush(): void {
    this.flushTimer = undefined;
    if (this.pending.length === 0) return;
    const message = encodeEvents(this.pending);
    log.debug('broadcast', {
      events: this.pending.length,
      bytes: message.length,
      clients: this.clientCount,
    });
    this.lastSentId = this.newestId();
    this.pending = [];
    for (const ws of this.wss.clients) this.send(ws, message);
  }

  private send(ws: WebSocket, message: Uint8Array): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > this.options.maxBufferedBytes) {
      log.warn('slow client dropped', {
        id: this.connections.get(ws)?.id,
        buffered: ws.bufferedAmount,
      });
      ws.terminate();
      return;
    }
    ws.send(message);
  }

  private ping(): void {
    for (const ws of this.wss.clients) {
      const connection = this.connections.get(ws);
      if (!connection) continue;
      if (!connection.alive) {
        log.info('dead client dropped', { id: connection.id });
        ws.terminate();
        continue;
      }
      connection.alive = false;
      ws.ping();
    }
  }
}
