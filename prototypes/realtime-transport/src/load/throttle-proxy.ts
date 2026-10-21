import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

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
    }
    client.pipe(upstream);
    client.on('close', () => upstream.destroy());
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());

    // 100 ms worth of bytes at a time: a large chunk (a catch-up response) trickles out as on a
    // slow link. Delaying it whole would hold back even its headers for minutes.
    const slice = Math.max(1, Math.floor(bytesPerSecond / 10));
    let delivered = Promise.resolve();
    upstream.on('data', (chunk: Buffer) => {
      upstream.pause();
      delivered = delivered.then(async () => {
        for (let offset = 0; offset < chunk.length && !client.destroyed; offset += slice) {
          const part = chunk.subarray(offset, offset + slice);
          await sleep((part.length / bytesPerSecond) * 1_000);
          client.write(part);
        }
        upstream.resume();
      });
    });
    // On a real slow link the server's FIN arrives after its data, so the client still gets
    // everything the server sent before it closed (a keep-alive timeout, a dropped client).
    upstream.on('end', () => void delivered.then(() => client.end()));
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
