import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  LiveConnection,
  decodeMessage,
  reconnectDelay,
  type LiveEvent,
  type LiveHandlers,
  type SocketLike,
} from './live';
import { setLogLevel } from './log';

// LiveConnection logs every connect and drop, the test output does not need it.
setLogLevel('error');

// The layout written by encodeEvents on the backend.
function eventsMessage(events: LiveEvent[]): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(5 + events.length * 9));
  view.setUint8(0, 1);
  view.setUint32(1, events.length, true);
  events.forEach((e, i) => {
    view.setUint32(5 + i * 9, e.id, true);
    view.setUint32(5 + i * 9 + 4, e.position, true);
    view.setUint8(5 + i * 9 + 8, e.color_id);
  });
  return view.buffer;
}

const RELOAD = new Uint8Array([2]).buffer;

describe('decodeMessage', () => {
  it('reads events and reload', () => {
    const events = [
      { id: 70000, position: 65536, color_id: 3 },
      { id: 70001, position: 0, color_id: 0 },
    ];
    expect(decodeMessage(eventsMessage(events))).toEqual({ type: 'events', events });
    expect(decodeMessage(RELOAD)).toEqual({ type: 'reload' });
  });

  it('rejects an unknown type and a wrong length', () => {
    expect(() => decodeMessage(new Uint8Array([9]).buffer)).toThrow(/unknown message type 9/);
    const cut = eventsMessage([{ id: 1, position: 1, color_id: 1 }]).slice(0, 10);
    expect(() => decodeMessage(cut)).toThrow(/10 bytes for 1 events/);
  });
});

describe('reconnectDelay', () => {
  it('doubles from 0.5 s up to 30 s, randomized between half and full', () => {
    expect(reconnectDelay(1, () => 0)).toBe(250);
    expect(reconnectDelay(1, () => 1)).toBe(500);
    expect(reconnectDelay(3, () => 1)).toBe(2000);
    expect(reconnectDelay(50, () => 1)).toBe(30_000);
    expect(reconnectDelay(50, () => 0)).toBe(15_000);
  });
});

class FakeSocket implements SocketLike {
  binaryType: BinaryType = 'blob';
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  closed = false;
  constructor(readonly url: string) {}
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.call(this as never, new Event('open'));
  }
  receive(data: ArrayBuffer): void {
    this.onmessage?.call(this as never, { data } as MessageEvent);
  }
  drop(): void {
    this.onclose?.call(this as never, {} as CloseEvent);
  }
}

describe('LiveConnection', () => {
  let sockets: FakeSocket[];
  let lastEventId: number;
  let handlers: { [K in keyof LiveHandlers]: Mock<LiveHandlers[K]> };
  let connection: LiveConnection;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    lastEventId = 10;
    handlers = {
      onEvents: vi.fn<LiveHandlers['onEvents']>(),
      onReload: vi.fn<LiveHandlers['onReload']>(),
      onConnectedChange: vi.fn<LiveHandlers['onConnectedChange']>(),
    };
    connection = new LiveConnection(
      () => lastEventId,
      handlers,
      (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      (after) => `ws://test/api/ws?after=${after}`
    );
  });

  afterEach(() => {
    connection.stop();
    vi.useRealTimers();
  });

  it('passes events on and reconnects after a drop with the current last event id', () => {
    connection.start();
    expect(sockets[0].url).toBe('ws://test/api/ws?after=10');
    expect(sockets[0].binaryType).toBe('arraybuffer');
    sockets[0].open();
    expect(handlers.onConnectedChange).toHaveBeenLastCalledWith(true);

    const events = [{ id: 11, position: 5, color_id: 2 }];
    sockets[0].receive(eventsMessage(events));
    expect(handlers.onEvents).toHaveBeenCalledWith(events);

    lastEventId = 11;
    sockets[0].drop();
    expect(handlers.onConnectedChange).toHaveBeenLastCalledWith(false);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    expect(sockets[1].url).toBe('ws://test/api/ws?after=11');
  });

  it('waits longer after every failed attempt', () => {
    connection.start();
    sockets[0].drop();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    sockets[1].drop(); // never opened
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(501);
    expect(sockets).toHaveLength(3);
  });

  it('stops on reload and does not reconnect', () => {
    connection.start();
    sockets[0].open();
    sockets[0].receive(RELOAD);
    expect(handlers.onReload).toHaveBeenCalledOnce();
    expect(sockets[0].closed).toBe(true);
    sockets[0].drop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('closes the socket on a broken message, then reconnects', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    connection.start();
    sockets[0].receive(new Uint8Array([9]).buffer);
    expect(sockets[0].closed).toBe(true);
    expect(handlers.onEvents).not.toHaveBeenCalled();
    sockets[0].drop();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
  });

  it('does not reconnect after stop', () => {
    connection.start();
    connection.stop();
    sockets[0].drop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
});
