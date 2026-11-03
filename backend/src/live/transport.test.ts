import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { attachLiveTransport, type LiveTransportOptions } from './transport.js';

type Transport = ReturnType<typeof attachLiveTransport>;

const servers: http.Server[] = [];
const transports: Transport[] = [];
const clients: WebSocket[] = [];

async function createServer(
  maxConnections = 10,
  liveness?: LiveTransportOptions['liveness']
): Promise<{
  address: string;
  transport: Transport;
}> {
  const server = http.createServer();
  servers.push(server);

  const transport = attachLiveTransport(server, {
    path: '/api/ws',
    maxConnections,
    allowedOrigins: [],
    maxPayload: 1024,
    maxBufferedBytes: 1024 * 1024,
    liveness,
  });

  transports.push(transport);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address');
  }

  return {
    address: `ws://127.0.0.1:${address.port}`,
    transport,
  };
}

function connect(address: string, options: WebSocket.ClientOptions = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(address, options);
    clients.push(ws);

    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function connectExpectStatus(
  address: string,
  expectedStatus: number,
  options: WebSocket.ClientOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(address, options);
    clients.push(ws);

    ws.once('unexpected-response', (_request, response) => {
      const status = response.statusCode;

      response.resume();
      ws.terminate();

      if (status === expectedStatus) {
        resolve();
      } else {
        reject(new Error(`Expected HTTP ${expectedStatus}, received ${status}`));
      }
    });

    ws.once('open', () => {
      reject(new Error('Connection unexpectedly accepted'));
    });

    ws.once('error', reject);
  });
}

function waitForClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once('close', (code) => resolve(code));
  });
}

afterEach(async () => {
  for (const transport of transports.splice(0)) {
    transport.close();
  }

  for (const ws of clients.splice(0)) {
    ws.on('error', () => {});
    ws.terminate();
  }

  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        })
    )
  );
});

describe('Live WebSocket transport integration', () => {
  it('accepts a WebSocket and registers the connection', async () => {
    const { address, transport } = await createServer();

    expect(transport.registry.size).toBe(0);

    const ws = await connect(`${address}/api/ws`);

    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(transport.registry.size).toBe(1);
    expect(transport.registry.stats().open).toBe(1);
  });

  it('removes the connection after the client disconnects', async () => {
    const { address, transport } = await createServer();

    const ws = await connect(`${address}/api/ws`);

    expect(transport.registry.size).toBe(1);

    const closed = waitForClose(ws);

    ws.close(1000, 'Test complete');

    await closed;

    await vi.waitFor(() => {
      expect(transport.registry.size).toBe(0);
    });

    expect(transport.registry.stats().open).toBe(0);
  });

  it('rejects a new connection when the limit is reached', async () => {
    const { address, transport } = await createServer(1);

    const first = await connect(`${address}/api/ws`);

    expect(first.readyState).toBe(WebSocket.OPEN);
    expect(transport.registry.size).toBe(1);

    await connectExpectStatus(`${address}/api/ws`, 503);

    expect(transport.registry.size).toBe(1);
  });

  it('rejects a foreign Origin', async () => {
    const { address, transport } = await createServer();

    await connectExpectStatus(`${address}/api/ws`, 403, {
      origin: 'https://foreign.example',
    });

    expect(transport.registry.size).toBe(0);
  });

  it('closes connected clients during shutdown', async () => {
    const { address, transport } = await createServer();

    const ws = await connect(`${address}/api/ws`);

    expect(transport.registry.size).toBe(1);

    const closed = waitForClose(ws);

    transport.close();

    const closeCode = await closed;

    expect(closeCode).toBe(1001);

    await vi.waitFor(() => {
      expect(transport.registry.size).toBe(0);
    });
  });

  it('keeps a client connected when it responds to ping', async () => {
    const { address, transport } = await createServer(10, {
      idleMs: 40,
      pongTimeoutMs: 100,
      intervalMs: 10,
    });

    // WebSocket clients automatically respond to ping by default.
    const ws = await connect(`${address}/api/ws`);

    let receivedPings = 0;

    ws.on('ping', () => {
      receivedPings++;
    });

    await vi.waitFor(
      () => {
        expect(receivedPings).toBeGreaterThan(0);
      },
      { timeout: 1000, interval: 10 }
    );

    // Wait longer than the pong timeout.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 150);
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(transport.registry.size).toBe(1);
    expect(transport.registry.stats().terminated).toBe(0);
  });

  it('terminates a client that does not answer ping', async () => {
    const { address, transport } = await createServer(10, {
      idleMs: 40,
      pongTimeoutMs: 60,
      intervalMs: 10,
    });

    // Disable automatic pong replies.
    const ws = new WebSocket(`${address}/api/ws`, {
      autoPong: false,
    });

    clients.push(ws);

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    let receivedPings = 0;

    ws.on('ping', () => {
      receivedPings++;
    });

    const closed = waitForClose(ws);

    await vi.waitFor(
      () => {
        expect(receivedPings).toBeGreaterThan(0);
      },
      { timeout: 1000, interval: 10 }
    );

    const closeCode = await closed;

    // Forced termination results in an abnormal closure.
    expect(closeCode).toBe(1006);

    await vi.waitFor(() => {
      expect(transport.registry.size).toBe(0);
    });

    expect(transport.registry.stats().terminated).toBe(1);
  });

  it('terminates an oversized message exactly once', async () => {
    const { address, transport } = await createServer();

    const ws = await connect(`${address}/api/ws`);

    expect(transport.registry.size).toBe(1);
    expect(transport.registry.stats().terminated).toBe(0);

    const closed = waitForClose(ws);

    // The server allows 1024 bytes; send 2048 bytes.
    ws.send('x'.repeat(2048));

    const closeCode = await closed;

    // A protocol error or forced termination closes the connection.
    expect([1006, 1009]).toContain(closeCode);

    await vi.waitFor(() => {
      expect(transport.registry.size).toBe(0);
    });

    // The registry should count only one termination.
    expect(transport.registry.stats().terminated).toBe(1);
    expect(transport.registry.stats().open).toBe(0);
  });
});
