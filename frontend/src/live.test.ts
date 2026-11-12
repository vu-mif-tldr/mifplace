import { applyPixels, connectLive, liveUrl, type SocketLike } from './live';

// A WebSocket the test drives: it records the URL and lets the test emit messages and closes
class FakeSocket implements SocketLike {
  static created: FakeSocket[] = [];
  readonly listeners = {
    message: [] as ((event: { data: unknown }) => void)[],
    close: [] as (() => void)[],
  };
  close = vi.fn(() => this.emitClose());

  constructor(readonly url: string) {
    FakeSocket.created.push(this);
  }

  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'message' | 'close', listener: unknown) {
    (this.listeners[type] as unknown[]).push(listener);
  }

  emit(message: unknown) {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    for (const listener of this.listeners.message) listener({ data });
  }

  emitClose() {
    for (const listener of this.listeners.close) listener();
  }
}

const createSocket = (url: string) => new FakeSocket(url);
const location = { protocol: 'http:', host: '127.0.0.1:5173' };
const checkpoint = { eventId: 102, timestamp: 1760000000000 };

function connect(handlers: Partial<Parameters<typeof connectLive>[1]> = {}) {
  const onPixels = vi.fn();
  const onReset = vi.fn();
  const onClose = vi.fn();
  const connection = connectLive(
    checkpoint,
    { onPixels, onReset, onClose, ...handlers },
    { createSocket, location }
  );
  const socket = FakeSocket.created[FakeSocket.created.length - 1];
  return { connection, socket, onPixels, onReset, onClose };
}

beforeEach(() => {
  FakeSocket.created = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('liveUrl', () => {
  it('uses the host of the page and the checkpoint', () => {
    expect(liveUrl(checkpoint, { protocol: 'http:', host: '127.0.0.1:5173' })).toBe(
      'ws://127.0.0.1:5173/api/ws?afterEventId=102&afterTimestamp=1760000000000'
    );
  });

  it('is wss: on https', () => {
    expect(liveUrl({ eventId: 0, timestamp: 0 }, { protocol: 'https:', host: 'vu.place' })).toBe(
      'wss://vu.place/api/ws?afterEventId=0&afterTimestamp=0'
    );
  });
});

describe('applyPixels', () => {
  const message = {
    type: 'pixels' as const,
    pixels: [
      [101, 1, 5],
      [102, 2, 5],
      [103, 4, 12],
      [104, 5, 5],
    ] as [number, number, number][],
    eventId: 104,
    timestamp: 1760000000100,
  };

  it('keeps the entries newer than the checkpoint, in order, and moves the checkpoint', () => {
    expect(applyPixels(message, checkpoint)).toEqual({
      pixels: [
        { pos: 4, colorId: 12 },
        { pos: 5, colorId: 5 },
      ],
      checkpoint: { eventId: 104, timestamp: 1760000000100 },
    });
  });

  it('leaves the checkpoint alone for a message entirely in the past', () => {
    const old = { ...message, pixels: message.pixels.slice(0, 2), eventId: 102, timestamp: 1 };
    expect(applyPixels(old, checkpoint)).toEqual({ pixels: [], checkpoint });
  });
});

describe('connectLive', () => {
  it('opens the socket with the checkpoint of the snapshot', () => {
    const { socket } = connect();
    expect(socket.url).toBe(liveUrl(checkpoint, location));
  });

  it('paints the new pixels of every message and resumes from the last applied one', () => {
    const { connection, socket, onPixels } = connect();

    socket.emit({
      type: 'pixels',
      pixels: [
        [102, 1, 5],
        [103, 4, 12],
      ],
      eventId: 103,
      timestamp: 1760000000050,
    });
    expect(onPixels).toHaveBeenLastCalledWith([{ pos: 4, colorId: 12 }]);
    expect(connection.checkpoint).toEqual({ eventId: 103, timestamp: 1760000000050 });

    // The next batch repeats 103 (sent before this page was registered): skipped
    socket.emit({
      type: 'pixels',
      pixels: [
        [103, 4, 12],
        [104, 5, 5],
      ],
      eventId: 104,
      timestamp: 1760000000100,
    });
    expect(onPixels).toHaveBeenLastCalledWith([{ pos: 5, colorId: 5 }]);
    expect(connection.checkpoint).toEqual({ eventId: 104, timestamp: 1760000000100 });
  });

  it('keeps the checkpoint when painting throws, so the batch is applied again later', () => {
    const { connection, socket } = connect({
      onPixels: () => {
        throw new Error('canvas is gone');
      },
    });
    expect(() =>
      socket.emit({ type: 'pixels', pixels: [[103, 4, 12]], eventId: 103, timestamp: 1 })
    ).toThrow('canvas is gone');
    expect(connection.checkpoint).toEqual(checkpoint);
  });

  it('closes the socket and calls onReset on a reset, without onClose', () => {
    const { socket, onReset, onClose } = connect();

    socket.emit({ type: 'reset' });

    expect(socket.close).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the server or the network closes the connection', () => {
    const { socket, onClose } = connect();
    socket.emitClose();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose after close()', () => {
    const { connection, socket, onClose } = connect();
    connection.close();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', 'hello'],
    ['an unknown message type', { type: 'hb' }],
    ['a pixels message without a checkpoint', { type: 'pixels', pixels: [[103, 4, 12]] }],
  ])('ignores %s with a warning', (_case, message) => {
    const { connection, socket, onPixels, onReset } = connect();
    socket.emit(message);
    expect(onPixels).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    expect(connection.checkpoint).toEqual(checkpoint);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
