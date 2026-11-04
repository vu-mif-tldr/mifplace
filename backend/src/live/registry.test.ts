import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { ConnectionRegistry } from './registry.js';

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  autoClose = true;

  send = vi.fn();
  ping = vi.fn();

  close = vi.fn((code: number) => {
    this.readyState = WebSocket.CLOSING;

    if (this.autoClose) {
      this.finishClose(code);
    }
  });

  terminate = vi.fn(() => {
    this.readyState = WebSocket.CLOSING;

    if (this.autoClose) {
      this.finishClose(1006);
    }
  });

  finishClose(code: number): void {
    this.readyState = WebSocket.CLOSED;
    this.emit('close', code);
  }
}

function addFakeSocket(registry: ConnectionRegistry, ip = '127.0.0.1') {
  const socket = new FakeSocket();
  const connection = registry.add(socket as unknown as WebSocket, ip);

  return { socket, connection };
}

describe('ConnectionRegistry', () => {
  it('registers connections with unique IDs', () => {
    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 });

    const first = addFakeSocket(registry);
    const second = addFakeSocket(registry);

    expect(first.connection.id).not.toBe(second.connection.id);
    expect(first.connection.ip).toBe('127.0.0.1');
    expect(first.connection.connectedAt).toEqual(expect.any(Number));
    expect(registry.size).toBe(2);
  });

  it('sends text to one connection', () => {
    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 });

    const first = addFakeSocket(registry);
    const second = addFakeSocket(registry);

    registry.send(first.connection, 'hello');

    expect(first.socket.send).toHaveBeenCalledWith('hello');
    expect(second.socket.send).not.toHaveBeenCalled();
  });

  it('broadcasts the same text to every open connection', () => {
    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 });

    const first = addFakeSocket(registry);
    const second = addFakeSocket(registry);

    registry.broadcast('pixels');

    expect(first.socket.send).toHaveBeenCalledWith('pixels');
    expect(second.socket.send).toHaveBeenCalledWith('pixels');
  });

  it('does not send to a socket that is not open', () => {
    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 });
    const { socket, connection } = addFakeSocket(registry);

    socket.readyState = WebSocket.CLOSING;

    registry.send(connection, 'hello');
    registry.ping(connection);

    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.ping).not.toHaveBeenCalled();
  });

  it('drops a slow client and updates statistics', () => {
    const registry = new ConnectionRegistry({ maxBufferedBytes: 100 });
    const { socket, connection } = addFakeSocket(registry);

    socket.bufferedAmount = 101;

    registry.send(connection, 'hello');

    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(registry.stats()).toEqual({
      open: 0,
      slowDropped: 1,
      terminated: 1,
    });
  });

  it('allows sending at the buffer limit', () => {
    const registry = new ConnectionRegistry({ maxBufferedBytes: 100 });
    const { socket, connection } = addFakeSocket(registry);

    socket.bufferedAmount = 100;

    registry.send(connection, 'hello');

    expect(socket.send).toHaveBeenCalledWith('hello');
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it('calls message and activity hooks for text messages', () => {
    const onMessage = vi.fn();
    const onActivity = vi.fn();

    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 }, { onMessage, onActivity });

    const { socket, connection } = addFakeSocket(registry);

    socket.emit('message', Buffer.from('hello'), false);

    expect(onMessage).toHaveBeenCalledWith(connection, 'hello');
    expect(onActivity).toHaveBeenCalledWith(connection);
  });

  it('calls the activity hook when a pong arrives', () => {
    const onActivity = vi.fn();
    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 }, { onActivity });

    const { socket, connection } = addFakeSocket(registry);

    socket.emit('pong');

    expect(onActivity).toHaveBeenCalledWith(connection);
  });

  it('closes binary messages with code 1003', () => {
    const onMessage = vi.fn();
    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 }, { onMessage });

    const { socket } = addFakeSocket(registry);

    socket.emit('message', Buffer.from([1, 2, 3]), true);

    expect(socket.close).toHaveBeenCalledWith(1003, 'Binary messages are not supported');
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('terminates a socket when an error occurs', () => {
    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 });
    const { socket } = addFakeSocket(registry);

    socket.emit('error', new Error('Socket failure'));

    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(registry.size).toBe(0);
  });

  it('removes closed connections and calls onClose', () => {
    const onClose = vi.fn();
    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 }, { onClose });

    const { socket, connection } = addFakeSocket(registry);

    socket.emit('close', 1000);

    expect(registry.size).toBe(0);
    expect(onClose).toHaveBeenCalledWith(connection, 1000);
  });

  it('pings and closes an open connection', () => {
    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 });
    const { socket, connection } = addFakeSocket(registry);

    registry.ping(connection);
    registry.close(connection, 1001, 'Server shutdown');

    expect(socket.ping).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledWith(1001, 'Server shutdown');
  });

  it('closes all connections', () => {
    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 });
    const first = addFakeSocket(registry);
    const second = addFakeSocket(registry);

    registry.closeAll(1001, 'Server shutdown');

    expect(first.socket.close).toHaveBeenCalledWith(1001, 'Server shutdown');
    expect(second.socket.close).toHaveBeenCalledWith(1001, 'Server shutdown');
    expect(registry.size).toBe(0);
  });

  it('does not terminate the same connection twice', () => {
    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 });
    const { socket, connection } = addFakeSocket(registry);

    socket.autoClose = false;

    registry.terminate(connection);
    registry.terminate(connection);

    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(registry.stats().terminated).toBe(1);
    expect(registry.stats().open).toBe(0);
    expect(registry.size).toBe(1);

    socket.finishClose(1006);

    expect(registry.size).toBe(0);
  });

  it('does not drop a slow client more than once', () => {
    const registry = new ConnectionRegistry({ maxBufferedBytes: 100 });
    const { socket, connection } = addFakeSocket(registry);

    socket.autoClose = false;
    socket.bufferedAmount = 101;

    registry.send(connection, 'first');
    registry.send(connection, 'second');

    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(registry.stats().slowDropped).toBe(1);
    expect(registry.stats().terminated).toBe(1);
  });

  it('ignores messages and pongs after termination starts', () => {
    const onMessage = vi.fn();
    const onActivity = vi.fn();

    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 }, { onMessage, onActivity });

    const { socket, connection } = addFakeSocket(registry);

    socket.autoClose = false;
    registry.terminate(connection);

    socket.emit('message', Buffer.from('late message'), false);
    socket.emit('pong');

    expect(onMessage).not.toHaveBeenCalled();
    expect(onActivity).not.toHaveBeenCalled();
  });

  it('ignores messages and pongs after a connection closes', () => {
    const onMessage = vi.fn();
    const onActivity = vi.fn();

    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 }, { onMessage, onActivity });

    const { socket } = addFakeSocket(registry);

    socket.finishClose(1000);

    socket.emit('message', Buffer.from('late message'), false);
    socket.emit('pong');

    expect(onMessage).not.toHaveBeenCalled();
    expect(onActivity).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  it('does not send or ping while a connection is closing', () => {
    const registry = new ConnectionRegistry({ maxBufferedBytes: 1024 });
    const { socket, connection } = addFakeSocket(registry);

    socket.autoClose = false;

    registry.close(connection, 1001, 'Server shutdown');
    registry.send(connection, 'late message');
    registry.ping(connection);

    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.ping).not.toHaveBeenCalled();

    socket.finishClose(1001);

    expect(registry.size).toBe(0);
  });
});
