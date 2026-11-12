import { LiveMessageSchema, type PixelsMessage } from '@mifplace/shared';

// The live connection of the page (docs/api.md, section 2): the server sends the pixels other
// people place, the page paints them. Clients send nothing. When the connection drops the page
// connects again by itself, from the last batch it applied, with a growing delay ("Connection
// recovery"). The socket is created through createSocket, so the tests use a fake one.

// The last event the page has applied: from the GET /api/canvas snapshot, then from every
// pixels message once it is applied. Both values go into the URL when connecting.
export type Checkpoint = { eventId: number; timestamp: number };

// One pixel to paint: pos as in toPosition, colorId a palette id (negative: unpainted)
export type LivePixel = { pos: number; colorId: number };

// connecting: the first socket is on its way. connected: live. reconnecting: the connection
// dropped, the page waits and tries again; updates are paused meanwhile.
export type LiveState = 'connecting' | 'connected' | 'reconnecting';

export interface LiveHandlers {
  // Paint these pixels, in order. Throwing leaves the checkpoint where it was.
  onPixels(pixels: LivePixel[]): void;
  // The server cannot resume from the checkpoint: load GET /api/canvas again and connect
  // again with its checkpoint. This connection is closed and does not reconnect.
  onReset(): void;
  // The state changed, for an indicator on the page
  onState?(state: LiveState): void;
}

// The part of a WebSocket this module uses, so a test can pass a fake
export interface SocketLike {
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  close(): void;
}

// The part of window this module uses: the "online" event, to reconnect at once when the
// browser says the network is back instead of waiting out the delay
export interface OnlineEvents {
  addEventListener(type: 'online', listener: () => void): void;
  removeEventListener(type: 'online', listener: () => void): void;
}

export interface LiveConnection {
  // The checkpoint of the last applied message, what a reconnect resumes from
  readonly checkpoint: Checkpoint;
  readonly state: LiveState;
  // Stops for good: no reconnect, no more handlers
  close(): void;
}

export interface LiveOptions {
  // The WebSocket of the browser unless a test passes a fake
  createSocket?: (url: string) => SocketLike;
  // Where the page is, for the host and the scheme of the socket URL
  location?: { protocol: string; host: string };
  // The first reconnect waits about minDelayMs, every further one twice as long, up to
  // maxDelayMs; a successful connection starts over
  minDelayMs?: number;
  maxDelayMs?: number;
  // Source of the jitter, Math.random unless a test passes its own
  random?: () => number;
  // window, or null to reconnect by the delay only
  online?: OnlineEvents | null;
}

export const DEFAULT_MIN_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 30_000;

// /api/ws on the host of the page, wss: on https. The checkpoint tells the server where to
// continue; with the snapshot's checkpoint nothing between the snapshot and the socket is lost.
export function liveUrl(
  checkpoint: Checkpoint,
  { protocol, host }: { protocol: string; host: string }
): string {
  const scheme = protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams({
    afterEventId: String(checkpoint.eventId),
    afterTimestamp: String(checkpoint.timestamp),
  });
  return `${scheme}//${host}/api/ws?${query}`;
}

// What a pixels message changes for a page at `checkpoint`: the entries newer than the
// checkpoint, in order (a batch is one message for every client and may repeat events the page
// already has), and the checkpoint to save once they are all applied. A message entirely in the
// past leaves the checkpoint where it is.
export function applyPixels(
  message: PixelsMessage,
  checkpoint: Checkpoint
): { pixels: LivePixel[]; checkpoint: Checkpoint } {
  const pixels = message.pixels
    .filter(([eventId]) => eventId > checkpoint.eventId)
    .map(([, pos, colorId]) => ({ pos, colorId }));
  const next =
    message.eventId > checkpoint.eventId
      ? { eventId: message.eventId, timestamp: message.timestamp }
      : checkpoint;
  return { pixels, checkpoint: next };
}

// How long to wait before reconnect number `attempt` (0 for the first): minDelayMs doubled
// every attempt up to maxDelayMs, and between half and all of that at random, so pages that
// lost the same server do not all come back in the same instant.
export function reconnectDelay(
  attempt: number,
  minDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random
): number {
  const base = Math.min(maxDelayMs, minDelayMs * 2 ** attempt);
  return Math.round(base / 2 + random() * (base / 2));
}

// Opens the socket from the checkpoint, dispatches its messages to the handlers and reconnects
// after a drop. A message that is not JSON or not a known message is ignored (docs/api.md:
// the client ignores what it does not know), with a warning in the console.
export function connectLive(
  checkpoint: Checkpoint,
  handlers: LiveHandlers,
  {
    createSocket = (url) => new WebSocket(url),
    location = window.location,
    minDelayMs = DEFAULT_MIN_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    random = Math.random,
    online = typeof window === 'undefined' ? null : window,
  }: LiveOptions = {}
): LiveConnection {
  let current = checkpoint;
  let state: LiveState = 'connecting';
  // After close() or a reset: no reconnect, no handlers
  let stopped = false;
  // How many reconnects failed in a row, for the delay
  let attempt = 0;
  let socket: SocketLike | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Reported only when it changes: a second failed attempt is still "reconnecting"
  function setState(next: LiveState) {
    if (state === next) return;
    state = next;
    handlers.onState?.(next);
  }

  function onMessage({ data }: { data: unknown }) {
    let message;
    try {
      message = LiveMessageSchema.safeParse(JSON.parse(String(data)));
    } catch {
      message = undefined;
    }
    if (!message?.success) {
      console.warn('Ignored a live message the page does not understand:', data);
      return;
    }
    if (message.data.type === 'reset') {
      // The server closes the connection after a reset too; stopping here first means its
      // close does not start a reconnect on top of the new snapshot
      stop();
      handlers.onReset();
      return;
    }
    const applied = applyPixels(message.data, current);
    handlers.onPixels(applied.pixels);
    // Only after the whole batch is applied, so a failed paint is retried from this checkpoint
    current = applied.checkpoint;
  }

  function open() {
    const opened = (socket = createSocket(liveUrl(current, location)));
    opened.addEventListener('open', () => {
      if (stopped || opened !== socket) return;
      attempt = 0;
      setState('connected');
    });
    opened.addEventListener('message', (event) => {
      if (!stopped && opened === socket) onMessage(event);
    });
    opened.addEventListener('close', () => {
      // Only the current socket counts; one closed by stop() or replaced is not a drop
      if (stopped || opened !== socket) return;
      socket = undefined;
      setState('reconnecting');
      timer = setTimeout(reconnect, reconnectDelay(attempt++, minDelayMs, maxDelayMs, random));
    });
  }

  function reconnect() {
    timer = undefined;
    open();
  }

  // The network is back: do not wait out the delay if one is running
  function onOnline() {
    if (stopped || timer === undefined) return;
    clearTimeout(timer);
    reconnect();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    timer = undefined;
    online?.removeEventListener('online', onOnline);
    socket?.close();
    socket = undefined;
  }

  online?.addEventListener('online', onOnline);
  handlers.onState?.(state);
  open();

  return {
    get checkpoint() {
      return current;
    },
    get state() {
      return state;
    },
    close: stop,
  };
}
