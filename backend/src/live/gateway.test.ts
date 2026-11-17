import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { attachGateway, getClientIp, type GatewayOptions } from './gateway.js';

const defaultOptions: GatewayOptions = {
  path: '/api/ws',
  maxConnections: 10,
  allowedOrigins: [],
  maxPayload: 1024,
};

type GatewayHandle = ReturnType<typeof attachGateway>;

type ConnectionHandler = (ws: WebSocket, request: { ip: string; url: URL }) => void;

const servers: http.Server[] = [];
const gateways: GatewayHandle[] = [];
const clients: WebSocket[] = [];

async function createServer(
  overrides: Partial<GatewayOptions> = {},
  currentCount: () => number = () => 0,
  onConnection: ConnectionHandler = () => {}
): Promise<{
  address: string;
  server: http.Server;
  gateway: GatewayHandle;
}> {
  const server = http.createServer();
  servers.push(server);

  const gateway = attachGateway(
    server,
    { ...defaultOptions, ...overrides },
    currentCount,
    onConnection
  );

  gateways.push(gateway);

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
    server,
    gateway,
  };
}

function connect(
  address: string,
  options: WebSocket.ClientOptions = {}
): Promise<{
  ws: WebSocket;
  status?: number;
  error?: Error;
}> {
  return new Promise((resolve) => {
    const ws = new WebSocket(address, options);
    clients.push(ws);

    ws.once('open', () => {
      resolve({ ws });
    });

    ws.once('unexpected-response', (_request, response) => {
      const status = response.statusCode;

      response.resume();
      ws.terminate();

      resolve({ ws, status });
    });

    ws.once('error', (error: Error) => {
      resolve({ ws, error });
    });
  });
}

afterEach(async () => {
  for (const ws of clients.splice(0)) {
    ws.on('error', () => {});
    ws.terminate();
  }

  for (const gateway of gateways.splice(0)) {
    gateway.close();
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

  vi.restoreAllMocks();
});

describe('attachGateway', () => {
  it('destroys the socket for a wrong path', async () => {
    const onConnection = vi.fn<ConnectionHandler>();

    const { address } = await createServer({}, () => 0, onConnection);

    const result = await connect(`${address}/wrong-path`);

    expect(result.error).toBeDefined();
    expect(onConnection).not.toHaveBeenCalled();
  });

  it('rejects a foreign Origin with 403', async () => {
    const onConnection = vi.fn<ConnectionHandler>();

    const { address } = await createServer({}, () => 0, onConnection);

    const result = await connect(`${address}/api/ws`, {
      origin: 'https://foreign.example',
    });

    expect(result.status).toBe(403);
    expect(onConnection).not.toHaveBeenCalled();
  });

  it('rejects connections with 503 when the limit is reached', async () => {
    const onConnection = vi.fn<ConnectionHandler>();

    const { address } = await createServer({ maxConnections: 2 }, () => 2, onConnection);

    const result = await connect(`${address}/api/ws`);

    expect(result.status).toBe(503);
    expect(onConnection).not.toHaveBeenCalled();
  });

  it('accepts a valid request and passes its IP and URL', async () => {
    const onConnection = vi.fn<ConnectionHandler>();

    const { address } = await createServer({}, () => 0, onConnection);

    const result = await connect(`${address}/api/ws?afterEventId=123`);

    expect(result.ws.readyState).toBe(WebSocket.OPEN);
    expect(onConnection).toHaveBeenCalledOnce();

    const [ws, request] = onConnection.mock.calls[0];

    expect(ws).toBeInstanceOf(WebSocket);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    expect(request.ip).toBe('127.0.0.1');
    expect(request.url.pathname).toBe('/api/ws');
    expect(request.url.searchParams.get('afterEventId')).toBe('123');
  });

  it('allows an Origin matching the Host header', async () => {
    const onConnection = vi.fn<ConnectionHandler>();

    const { address } = await createServer({}, () => 0, onConnection);

    const origin = address.replace('ws://', 'http://');

    const result = await connect(`${address}/api/ws`, {
      origin,
    });

    expect(result.ws.readyState).toBe(WebSocket.OPEN);
    expect(onConnection).toHaveBeenCalledOnce();
  });

  it('allows an Origin from allowedOrigins', async () => {
    const onConnection = vi.fn<ConnectionHandler>();

    const { address } = await createServer(
      {
        allowedOrigins: ['https://frontend.example'],
      },
      () => 0,
      onConnection
    );

    const result = await connect(`${address}/api/ws`, {
      origin: 'https://frontend.example',
    });

    expect(result.ws.readyState).toBe(WebSocket.OPEN);
    expect(onConnection).toHaveBeenCalledOnce();
  });

  it('allows requests without an Origin header', async () => {
    const onConnection = vi.fn<ConnectionHandler>();

    const { address } = await createServer({}, () => 0, onConnection);

    const result = await connect(`${address}/api/ws`);

    expect(result.ws.readyState).toBe(WebSocket.OPEN);
    expect(onConnection).toHaveBeenCalledOnce();
  });

  it('trusts X-Forwarded-For from a loopback peer', async () => {
    const onConnection = vi.fn<ConnectionHandler>();

    const { address } = await createServer({}, () => 0, onConnection);

    const result = await connect(`${address}/api/ws`, {
      headers: {
        'X-Forwarded-For': '203.0.113.42, 192.0.2.10',
      },
    });

    expect(result.ws.readyState).toBe(WebSocket.OPEN);
    expect(onConnection).toHaveBeenCalledOnce();

    expect(onConnection.mock.calls[0][1].ip).toBe('203.0.113.42');
  });

  it('removes the upgrade listener after close()', async () => {
    const onConnection = vi.fn<ConnectionHandler>();

    const { server, gateway } = await createServer({}, () => 0, onConnection);

    expect(server.listenerCount('upgrade')).toBe(1);

    gateway.close();

    expect(server.listenerCount('upgrade')).toBe(0);
    expect(onConnection).not.toHaveBeenCalled();
  });

  it('closes a client that sends a message larger than maxPayload', async () => {
    const onConnection = vi.fn<ConnectionHandler>();

    const { address } = await createServer({ maxPayload: 16 }, () => 0, onConnection);

    const result = await connect(`${address}/api/ws`);

    expect(result.ws.readyState).toBe(WebSocket.OPEN);
    expect(onConnection).toHaveBeenCalledOnce();

    const closeCode = new Promise<number>((resolve) => {
      result.ws.once('close', (code) => resolve(code));
    });

    // 32 bytes exceeds the configured 16-byte limit.
    result.ws.send('x'.repeat(32));

    // ws terminates the connection after rejecting the oversized frame.
    expect(await closeCode).toBe(1009);
  });

  it('ignores X-Forwarded-For from a non-loopback peer', () => {
    const ip = getClientIp('198.51.100.25', '203.0.113.42, 192.0.2.10');

    expect(ip).toBe('198.51.100.25');
  });
});

describe('attachGateway with accounts', () => {
  const owner = { userId: 7, session: 's'.repeat(64) };
  // Knows one session, by the cookie of the upgrade request
  const authenticate = (cookie: string | undefined) =>
    cookie === 'session=abc' ? owner : undefined;

  it('refuses an upgrade without a session with 401', async () => {
    const onConnection = vi.fn<ConnectionHandler>();
    const { address } = await createServer({ authenticate }, () => 0, onConnection);

    expect((await connect(`${address}/api/ws`)).status).toBe(401);
    const stale = await connect(`${address}/api/ws`, { headers: { cookie: 'session=old' } });
    expect(stale.status).toBe(401);
    expect(onConnection).not.toHaveBeenCalled();
  });

  it('lets a signed-in visitor in and says whose connection it is', async () => {
    const onConnection = vi.fn<ConnectionHandler>();
    const { address } = await createServer({ authenticate }, () => 0, onConnection);

    const result = await connect(`${address}/api/ws`, { headers: { cookie: 'session=abc' } });
    expect(result.status).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(onConnection).toHaveBeenCalledOnce();
    const request = onConnection.mock.calls[0][1] as { owner?: typeof owner };
    expect(request.owner).toEqual(owner);
  });

  it('answers 401 before it counts the connections', async () => {
    const { address } = await createServer({ authenticate, maxConnections: 1 }, () => 1);
    expect((await connect(`${address}/api/ws`)).status).toBe(401);
    const signedIn = await connect(`${address}/api/ws`, { headers: { cookie: 'session=abc' } });
    expect(signedIn.status).toBe(503);
  });
});
