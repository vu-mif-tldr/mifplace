import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts';
import type { EventLog } from '../event-log.ts';
import { parseEventId } from '../http-util.ts';
import type { Hub, PushClient } from '../hub.ts';

export interface WebSocketOptions {
  /** Protocol ping interval. A connection that missed one pong is terminated. */
  pingMs: number;
  /** A client with more unsent data than this is too slow and gets disconnected. */
  maxBufferedBytes: number;
}

/** GET /ws?after=<id>: batches from the server, placements from the client, one connection. */
export class WebSocketTransport {
  private readonly wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 1024,
  });
  /** Connections that answered the last ping. */
  private readonly alive = new WeakSet<WebSocket>();
  private readonly pingTimer: NodeJS.Timeout;
  private readonly hub: Hub;
  private readonly log: EventLog;
  private readonly options: WebSocketOptions;

  constructor(hub: Hub, log: EventLog, options: WebSocketOptions) {
    this.hub = hub;
    this.log = log;
    this.options = options;
    // Browsers do not expose protocol pings to JavaScript, so these only let the server notice
    // dead clients. The client notices a dead server by the hub's heartbeat messages.
    this.pingTimer = setInterval(() => this.ping(), options.pingMs);
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!isAllowedOrigin(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const after = parseEventId(
      new URL(req.url ?? '/', 'http://localhost').searchParams.get('after')
    );
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, after));
  }

  close(): void {
    clearInterval(this.pingTimer);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }

  private onConnection(ws: WebSocket, after: number): void {
    this.alive.add(ws);
    ws.on('pong', () => this.alive.add(ws));
    ws.on('error', () => ws.terminate());

    const { maxBufferedBytes } = this.options;
    const client: PushClient = {
      kind: 'ws',
      send(payload) {
        // Do not buffer without limit for a slow client: drop it, it catches up after reconnecting.
        if (ws.bufferedAmount > maxBufferedBytes) {
          ws.terminate();
          return;
        }
        ws.send(payload);
      },
      close: () => ws.terminate(),
    };
    this.hub.connect(client, after);
    ws.on('close', () => this.hub.disconnect(client));

    ws.on('message', (data, isBinary) => {
      const message = isBinary ? null : parseClientMessage(data);
      if (message === null) {
        ws.close(1003, 'unsupported message');
        return;
      }
      const reply: ServerMessage = {
        t: 'placed',
        req: message.req,
        result: this.log.place(message),
      };
      ws.send(JSON.stringify(reply));
    });
  }

  private ping(): void {
    for (const ws of this.wss.clients) {
      if (!this.alive.has(ws)) {
        ws.terminate();
        continue;
      }
      this.alive.delete(ws);
      ws.ping();
    }
  }
}

/**
 * Browsers apply neither the same-origin policy nor CORS to WebSockets, so any website could open
 * one with our users' cookies. The server has to check Origin itself. No Origin = not a browser.
 */
function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** Checks the envelope only; EventLog.place validates the placement itself. */
function parseClientMessage(data: RawData): ClientMessage | null {
  try {
    const message = JSON.parse(data.toString()) as Partial<ClientMessage> | null;
    return message?.t === 'place' && Number.isSafeInteger(message.req)
      ? (message as ClientMessage)
      : null;
  } catch {
    return null;
  }
}
