import {
  applyPixels,
  connectLive,
  liveUrl,
  reconnectDelay,
  type LiveHandlers,
  type SocketLike,
} from './live';

// A WebSocket the test drives: it records the URL and lets the test open it, emit messages
// and close it
class FakeSocket implements SocketLike {
  static created: FakeSocket[] = [];
  readonly listeners = {
    open: [] as (() => void)[],
    message: [] as ((event: { data: unknown }) => void)[],
    close: [] as (() => void)[],
  };
  // A real socket emits close after close(); the fake does the same at once
  close = vi.fn(() => this.emitClose());

  constructor(readonly url: string) {
    FakeSocket.created.push(this);
  }

  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'open' | 'message' | 'close', listener: unknown) {
    (this.listeners[type] as unknown[]).push(listener);
  }

  emitOpen() {
    for (const listener of this.listeners.open) listener();
  }

  emit(message: unknown) {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    for (const listener of this.listeners.message) listener({ data });
  }

  emitClose() {
    for (const listener of this.listeners.close) listener();
  }
}

// window with only the "online" event
class FakeOnline {
  listeners: (() => void)[] = [];
  addEventListener = (_type: 'online', listener: () => void) => void this.listeners.push(listener);
  removeEventListener = vi.fn((_type: 'online', listener: () => void) => {
    this.listeners = this.listeners.filter((l) => l !== listener);
  });
  goOnline = () => this.listeners.forEach((l) => l());
}

const createSocket = (url: string) => new FakeSocket(url);
const location = { protocol: 'http:', host: '127.0.0.1:5173' };
const checkpoint = { eventId: 102, timestamp: 1760000000000 };
const lastSocket = () => FakeSocket.created[FakeSocket.created.length - 1];

function connect(handlers: Partial<LiveHandlers> = {}, online = new FakeOnline()) {
  const onPixels = vi.fn();
  const onReset = vi.fn();
  const onState = vi.fn();
  const connection = connectLive(
    checkpoint,
    { onPixels, onReset, onState, ...handlers },
    // Jitter at its maximum, so a delay is exactly minDelayMs * 2^attempt
    { createSocket, location, minDelayMs: 500, maxDelayMs: 4000, random: () => 1, online }
  );
  const socket = lastSocket();
  socket.emitOpen();
  return { connection, socket, onPixels, onReset, onState, online };
}

beforeEach(() => {
  FakeSocket.created = [];
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

describe('reconnectDelay', () => {
  it('doubles from the minimum up to the maximum', () => {
    expect([0, 1, 2, 3, 4].map((attempt) => reconnectDelay(attempt, 500, 4000, () => 1))).toEqual([
      500, 1000, 2000, 4000, 4000,
    ]);
  });

  it('takes between half and all of the delay at random', () => {
    expect(reconnectDelay(1, 500, 4000, () => 0)).toBe(500);
    expect(reconnectDelay(1, 500, 4000, () => 0.5)).toBe(750);
    expect(reconnectDelay(1, 500, 4000, () => 0.999)).toBe(1000);
  });
});

describe('connectLive', () => {
  it('opens the socket with the checkpoint of the snapshot and reports the states', () => {
    const { connection, socket, onState } = connect();
    expect(socket.url).toBe(liveUrl(checkpoint, location));
    expect(onState.mock.calls.map(([state]) => state)).toEqual(['connecting', 'connected']);
    expect(connection.state).toBe('connected');
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

  it('reconnects after a drop, from the last applied checkpoint, with a growing delay', () => {
    const { connection, socket, onState } = connect();
    socket.emit({ type: 'pixels', pixels: [[103, 4, 12]], eventId: 103, timestamp: 1760000000050 });

    socket.emitClose();
    expect(connection.state).toBe('reconnecting');
    expect(FakeSocket.created).toHaveLength(1);

    // First attempt after 500 ms, with the checkpoint of the applied batch
    vi.advanceTimersByTime(499);
    expect(FakeSocket.created).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.created).toHaveLength(2);
    expect(lastSocket().url).toBe(liveUrl({ eventId: 103, timestamp: 1760000000050 }, location));

    // That one fails too: the next attempt waits twice as long
    lastSocket().emitClose();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.created).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.created).toHaveLength(3);

    // Connected again: the state says so and the delay starts over
    lastSocket().emitOpen();
    expect(connection.state).toBe('connected');
    lastSocket().emitClose();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.created).toHaveLength(4);

    expect(onState.mock.calls.map(([state]) => state)).toEqual([
      'connecting',
      'connected',
      'reconnecting',
      'connected',
      'reconnecting',
    ]);
  });

  it('keeps painting on the new socket after a reconnect', () => {
    const { socket, onPixels } = connect();
    socket.emitClose();
    vi.advanceTimersByTime(500);
    const reconnected = lastSocket();
    reconnected.emitOpen();

    reconnected.emit({ type: 'pixels', pixels: [[103, 4, 12]], eventId: 103, timestamp: 1 });
    expect(onPixels).toHaveBeenCalledWith([{ pos: 4, colorId: 12 }]);
  });

  it('reconnects at once when the browser comes back online', () => {
    const { socket, online } = connect();
    socket.emitClose();
    vi.advanceTimersByTime(100);

    online.goOnline();
    expect(FakeSocket.created).toHaveLength(2);
    // The timer that was running does not open a third socket
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.created).toHaveLength(2);
  });

  it('ignores the online event while a socket is on its way or connected', () => {
    const { online } = connect();
    online.goOnline();
    expect(FakeSocket.created).toHaveLength(1);
  });

  it('closes the socket and calls onReset on a reset, without reconnecting', () => {
    const { socket, onReset, onState, online } = connect();

    socket.emit({ type: 'reset' });

    expect(socket.close).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.created).toHaveLength(1);
    expect(onState).not.toHaveBeenCalledWith('reconnecting');
    expect(online.removeEventListener).toHaveBeenCalled();
  });

  it('does not reconnect or report anything after close()', () => {
    const { connection, socket, onState, online } = connect();
    connection.close();
    expect(socket.close).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(10_000);
    online.goOnline();
    expect(FakeSocket.created).toHaveLength(1);
    expect(onState.mock.calls.map(([state]) => state)).toEqual(['connecting', 'connected']);
  });

  it('does not reconnect when close() is called while waiting', () => {
    const { connection, socket } = connect();
    socket.emitClose();
    connection.close();
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.created).toHaveLength(1);
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
