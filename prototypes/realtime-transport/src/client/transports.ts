import type {
  ClientMessage,
  PlaceResult,
  ServerMessage,
  TransportName,
} from '../shared/protocol.ts';

// Client sides of the four transports behind one interface. No DOM, only fetch, WebSocket and
// EventSource, so the same code runs in the browser and in the Node tests.

export type TransportState = 'connecting' | 'open' | 'stopped';

export interface TransportOptions {
  baseUrl: string;
  /** Push transports reconnect when nothing, not even a heartbeat, arrives for this long. */
  silenceTimeoutMs: number;
  /** Pause between two short polls. */
  pollIntervalMs: number;
  /** Client-side limit for one long-poll request. Must be longer than the server's timeout. */
  longPollTimeoutMs: number;
  reconnectMinMs: number;
  reconnectMaxMs: number;
}

export const DEFAULT_TRANSPORT_OPTIONS: Omit<TransportOptions, 'baseUrl'> = {
  silenceTimeoutMs: 40_000,
  pollIntervalMs: 1_000,
  longPollTimeoutMs: 35_000,
  reconnectMinMs: 500,
  reconnectMaxMs: 10_000,
};

export interface TransportCallbacks {
  /** The cursor (see protocol.ts) a new connection or request continues from. */
  cursor(): string;
  onMessage(message: ServerMessage): void;
  onState(state: TransportState, detail?: string): void;
}

export interface Transport {
  start(): void;
  /** Stops for good: no callbacks after this, until start() is called again. */
  stop(): void;
  /** Simulates a lost connection: closes it and lets the transport reconnect by itself. */
  drop(): void;
  place(x: number, y: number, color: number): Promise<PlaceResult>;
}

export function createTransport(
  name: TransportName,
  options: TransportOptions,
  callbacks: TransportCallbacks
): Transport {
  switch (name) {
    case 'ws':
      return new WebSocketTransport(options, callbacks);
    case 'sse':
      return new SseTransport(options, callbacks);
    case 'lp':
      return new PollingTransport('/api/lp', 0, options.longPollTimeoutMs, options, callbacks);
    case 'poll':
      return new PollingTransport('/api/poll', options.pollIntervalMs, 10_000, options, callbacks);
  }
}

/** Exponential backoff with full jitter, so that clients do not all reconnect at the same moment. */
class Backoff {
  private attempt = 0;
  private readonly minMs: number;
  private readonly maxMs: number;

  constructor(minMs: number, maxMs: number) {
    this.minMs = minMs;
    this.maxMs = maxMs;
  }

  next(): number {
    this.attempt++;
    return Math.random() * Math.min(this.maxMs, this.minMs * 2 ** this.attempt);
  }

  reset(): void {
    this.attempt = 0;
  }
}

/** What WebSocket and SSE share: reconnecting with backoff and noticing a silent connection. */
abstract class PushTransport implements Transport {
  protected readonly options: TransportOptions;
  protected readonly callbacks: TransportCallbacks;
  private readonly backoff: Backoff;
  private stopped = true;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: TransportOptions, callbacks: TransportCallbacks) {
    this.options = options;
    this.callbacks = callbacks;
    this.backoff = new Backoff(options.reconnectMinMs, options.reconnectMaxMs);
  }

  abstract place(x: number, y: number, color: number): Promise<PlaceResult>;
  /** Opens a connection that continues from callbacks.cursor(). */
  protected abstract connect(): void;
  /** Closes the current connection, if any, without reporting it as lost. */
  protected abstract disconnect(): void;

  start(): void {
    this.stopped = false;
    this.callbacks.onState('connecting');
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.silenceTimer);
    this.disconnect();
    this.callbacks.onState('stopped');
  }

  drop(): void {
    this.lost('dropped on purpose');
  }

  protected opened(): void {
    this.backoff.reset();
    this.callbacks.onState('open');
    this.heard();
  }

  /** Call on every message, heartbeats included. */
  protected heard(): void {
    clearTimeout(this.silenceTimer);
    const timeout = this.options.silenceTimeoutMs;
    this.silenceTimer = setTimeout(() => this.lost(`nothing heard for ${timeout} ms`), timeout);
  }

  /** The connection is gone or useless: reconnect after a backoff delay. */
  protected lost(reason: string): void {
    if (this.stopped) return;
    clearTimeout(this.silenceTimer);
    clearTimeout(this.retryTimer);
    this.disconnect();
    const delay = this.backoff.next();
    this.callbacks.onState('connecting', `${reason}; retry in ${Math.round(delay)} ms`);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }
}

class WebSocketTransport extends PushTransport {
  private socket: WebSocket | null = null;
  private nextRequest = 1;
  private readonly pending = new Map<number, (result: PlaceResult) => void>();

  place(x: number, y: number, color: number): Promise<PlaceResult> {
    const socket = this.socket;
    // Over the open socket if there is one, otherwise the same POST the other transports use.
    if (socket?.readyState !== WebSocket.OPEN) {
      return postPlacement(this.options.baseUrl, x, y, color);
    }
    const req = this.nextRequest++;
    const message: ClientMessage = { t: 'place', req, x, y, color };
    socket.send(JSON.stringify(message));
    return new Promise((resolve) => this.pending.set(req, resolve));
  }

  protected connect(): void {
    const url = new URL('/ws', this.options.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('after', this.callbacks.cursor());

    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => this.opened();
    socket.onmessage = (event) => {
      this.heard();
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.t === 'placed') {
        this.pending.get(message.req)?.(message.result);
        this.pending.delete(message.req);
      } else {
        this.callbacks.onMessage(message);
      }
    };
    // Every error is followed by a close event, so errors need no handler of their own.
    socket.onclose = (event) => this.lost(`closed with code ${event.code}`);
  }

  protected disconnect(): void {
    const socket = this.socket;
    if (socket === null) return;
    this.socket = null;
    socket.onopen = socket.onmessage = socket.onclose = null;
    socket.close();
    for (const settle of this.pending.values()) settle({ ok: false, error: 'connection lost' });
    this.pending.clear();
  }
}

class SseTransport extends PushTransport {
  private source: EventSource | null = null;

  place(x: number, y: number, color: number): Promise<PlaceResult> {
    return postPlacement(this.options.baseUrl, x, y, color);
  }

  protected connect(): void {
    const url = new URL('/api/sse', this.options.baseUrl);
    url.searchParams.set('after', this.callbacks.cursor());

    const source = new EventSource(url);
    this.source = source;
    source.onopen = () => this.opened();
    source.onmessage = (event) => {
      this.heard();
      this.callbacks.onMessage(JSON.parse(event.data as string) as ServerMessage);
    };
    source.onerror = () => {
      // CONNECTING: the browser reconnects by itself after the server's `retry:` delay and sends
      // Last-Event-ID. CLOSED: it gave up (for example on an HTTP error status from a proxy while
      // the server restarts), so we start over ourselves.
      if (source.readyState === EventSource.CLOSED) this.lost('closed by the browser');
      else this.callbacks.onState('connecting', 'the browser reconnects by itself');
    };
  }

  protected disconnect(): void {
    const source = this.source;
    if (source === null) return;
    this.source = null;
    source.onopen = source.onmessage = source.onerror = null;
    source.close();
  }
}

/** Long polling (pauseMs = 0, the server holds the request) and short polling (pauseMs > 0). */
class PollingTransport implements Transport {
  private readonly path: string;
  private readonly pauseMs: number;
  private readonly requestTimeoutMs: number;
  private readonly options: TransportOptions;
  private readonly callbacks: TransportCallbacks;
  private readonly backoff: Backoff;
  /** Bumped by start() and stop(); a loop from an older generation exits. */
  private generation = 0;
  private request: AbortController | null = null;

  constructor(
    path: string,
    pauseMs: number,
    requestTimeoutMs: number,
    options: TransportOptions,
    callbacks: TransportCallbacks
  ) {
    this.path = path;
    this.pauseMs = pauseMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.options = options;
    this.callbacks = callbacks;
    this.backoff = new Backoff(options.reconnectMinMs, options.reconnectMaxMs);
  }

  start(): void {
    void this.run(++this.generation);
  }

  stop(): void {
    this.generation++;
    this.request?.abort();
    this.callbacks.onState('stopped');
  }

  /** Aborts the request in flight. Between two short polls there is nothing to drop. */
  drop(): void {
    this.request?.abort();
  }

  place(x: number, y: number, color: number): Promise<PlaceResult> {
    return postPlacement(this.options.baseUrl, x, y, color);
  }

  private async run(generation: number): Promise<void> {
    const current = () => generation === this.generation;
    let open = false;
    this.callbacks.onState('connecting');

    while (current()) {
      const url = new URL(this.path, this.options.baseUrl);
      url.searchParams.set('after', this.callbacks.cursor());
      this.request = new AbortController();
      try {
        const response = await fetch(url, {
          signal: AbortSignal.any([
            this.request.signal,
            AbortSignal.timeout(this.requestTimeoutMs),
          ]),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // The headers are here: a parked long poll counts as open before its body arrives.
        if (!open && current()) {
          open = true;
          this.backoff.reset();
          this.callbacks.onState('open');
        }
        const message = (await response.json()) as ServerMessage;
        if (!current()) return;
        // May stop this transport (a reset makes the client reload the snapshot).
        this.callbacks.onMessage(message);
        if (this.pauseMs > 0) await sleep(this.pauseMs);
      } catch (error) {
        if (!current()) return;
        open = false;
        const delay = this.backoff.next();
        this.callbacks.onState(
          'connecting',
          `${describe(error)}; retry in ${Math.round(delay)} ms`
        );
        await sleep(delay);
      }
    }
  }
}

async function postPlacement(
  baseUrl: string,
  x: number,
  y: number,
  color: number
): Promise<PlaceResult> {
  try {
    const response = await fetch(new URL('/api/place', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y, color }),
    });
    return (await response.json()) as PlaceResult;
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
