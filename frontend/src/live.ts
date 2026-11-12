import { LiveMessageSchema, type PixelsMessage } from '@mifplace/shared';

// The live connection of the page (docs/api.md, section 2): the server sends the pixels other
// people place, the page paints them. Clients send nothing. The socket is created through
// createSocket, so the tests use a fake one.

// The last event the page has applied: from the GET /api/canvas snapshot, then from every
// pixels message once it is applied. Both values go into the URL when connecting.
export type Checkpoint = { eventId: number; timestamp: number };

// One pixel to paint: pos as in toPosition, colorId a palette id (negative: unpainted)
export type LivePixel = { pos: number; colorId: number };

export interface LiveHandlers {
  // Paint these pixels, in order. Throwing leaves the checkpoint where it was.
  onPixels(pixels: LivePixel[]): void;
  // The server cannot resume from the checkpoint: load GET /api/canvas again and connect
  // again with its checkpoint. The socket is already closed.
  onReset(): void;
  // The connection dropped (network, server restart, closed by the server). Not called after
  // close(). Reconnecting is MP-90.
  onClose?(): void;
}

// The part of a WebSocket this module uses, so a test can pass a fake
export interface SocketLike {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  close(): void;
}

export interface LiveConnection {
  // The checkpoint of the last applied message, what a reconnect resumes from
  readonly checkpoint: Checkpoint;
  close(): void;
}

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

export interface LiveOptions {
  // The WebSocket of the browser unless a test passes a fake
  createSocket?: (url: string) => SocketLike;
  // Where the page is, for the host and the scheme of the socket URL
  location?: { protocol: string; host: string };
}

// Opens the socket from the checkpoint and dispatches its messages to the handlers.
// A message that is not JSON or not a known message is ignored (docs/api.md: the client
// ignores what it does not know), with a warning in the console.
export function connectLive(
  checkpoint: Checkpoint,
  handlers: LiveHandlers,
  { createSocket = (url) => new WebSocket(url), location = window.location }: LiveOptions = {}
): LiveConnection {
  let current = checkpoint;
  let closedByUs = false;
  const socket = createSocket(liveUrl(current, location));

  socket.addEventListener('message', ({ data }) => {
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
      // The server closes the connection after a reset too; closing here as well means
      // onClose does not fire on top of onReset
      closedByUs = true;
      socket.close();
      handlers.onReset();
      return;
    }
    const applied = applyPixels(message.data, current);
    handlers.onPixels(applied.pixels);
    // Only after the whole batch is applied, so a failed paint is retried from this checkpoint
    current = applied.checkpoint;
  });

  socket.addEventListener('close', () => {
    if (!closedByUs) handlers.onClose?.();
  });

  return {
    get checkpoint() {
      return current;
    },
    close() {
      closedByUs = true;
      socket.close();
    },
  };
}
