import { connect, createServer, type AddressInfo, type Socket } from 'node:net';

export interface ThrottleProxy {
  url: string;
  close(): Promise<void>;
}

/**
 * A TCP proxy that passes the server's bytes on to the client at no more than `bytesPerSecond`
 * (test T5). It reads from the server only as fast as it forwards, so for the server it is a slow
 * reader, like a phone on a bad connection. The client behind it is an ordinary viewer that still
 * answers pings and reconnects; requests from the client pass at full speed.
 */
export async function startThrottleProxy(
  target: string,
  bytesPerSecond: number
): Promise<ThrottleProxy> {
  const { hostname, port } = new URL(target);
  const sockets = new Set<Socket>();

  const server = createServer((client) => {
    const upstream = connect(Number(port), hostname);
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      // A reset on one side is normal here; the 'close' handlers clean up.
      socket.on('error', () => {});
    }
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    client.pipe(upstream);
    upstream.on('data', (chunk: Buffer) => {
      upstream.pause();
      setTimeout(
        () => {
          if (!client.destroyed) client.write(chunk);
          upstream.resume();
        },
        (chunk.length / bytesPerSecond) * 1_000
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port: proxyPort } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${proxyPort}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
