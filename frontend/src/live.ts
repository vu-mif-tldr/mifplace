// Live updates from /api/ws. The messages are described in @mifplace/shared (live.ts), the
// client sends nothing.
import { decodeMessage, type LiveEvent, type LiveMessage } from '@mifplace/shared';
import { logger } from './log';

const log = logger('ws');

export { decodeMessage, type LiveEvent, type LiveMessage };

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 30_000;

// Delay before reconnect attempt n (1, 2, ...): doubles up to the maximum, then a random
// part of it, so that clients dropped together by a server restart do not return together.
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const max = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** (attempt - 1));
  return Math.round(max * (0.5 + random() / 2));
}

export interface LiveHandlers {
  onEvents(events: LiveEvent[]): void;
  // The server cannot catch this client up: the canvas must be loaded again. The connection
  // is closed and not reopened.
  onReload(): void;
  onConnectedChange(connected: boolean): void;
}

// The part of the browser WebSocket that LiveConnection uses, so tests can pass a fake.
export type SocketLike = Pick<
  WebSocket,
  'binaryType' | 'onopen' | 'onmessage' | 'onclose' | 'close'
>;

export function liveUrl(after: number): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/api/ws?after=${after}`;
}

// Keeps a connection to /api/ws open and reconnects after a drop. Every connect asks for the
// events after lastEventId(), so nothing is lost while the connection is down.
export class LiveConnection {
  private socket: SocketLike | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly lastEventId: () => number,
    private readonly handlers: LiveHandlers,
    private readonly createSocket: (url: string) => SocketLike = (url) => new WebSocket(url),
    private readonly url: (after: number) => string = liveUrl
  ) {}

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    const after = this.lastEventId();
    log.debug('connecting', { after, attempt: this.attempt });
    const socket = this.createSocket(this.url(after));
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      log.info('connected', { after, afterAttempts: this.attempt });
      this.attempt = 0;
      this.handlers.onConnectedChange(true);
    };
    socket.onmessage = (event) => {
      let message: LiveMessage;
      try {
        message = decodeMessage(event.data as ArrayBuffer);
      } catch (e) {
        // A broken message cannot be skipped safely, the next connect catches up instead.
        log.error('broken message, reconnecting', {}, e);
        socket.close();
        return;
      }
      if (message.type === 'reload') {
        log.info('server asked to reload the canvas', { after: this.lastEventId() });
        this.stop();
        this.handlers.onReload();
      } else {
        const events = message.events;
        log.debug('events received', {
          count: events.length,
          lastId: events.length > 0 ? events[events.length - 1].id : undefined,
        });
        this.handlers.onEvents(events);
      }
    };
    socket.onclose = (event) => {
      if (this.socket !== socket || this.stopped) return;
      this.socket = null;
      this.handlers.onConnectedChange(false);
      this.attempt++;
      const delay = reconnectDelay(this.attempt);
      // The first drop is worth seeing, the following failed attempts only at debug.
      (this.attempt === 1 ? log.info : log.debug)('disconnected, reconnecting', {
        code: event?.code,
        attempt: this.attempt,
        inMs: delay,
      });
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }
}
