// T6, risk R1: does the proxy speak HTTP/2, does it offer HTTP/3, and does it carry many SSE
// streams over one connection, the way several tabs of one browser would share it?
//
//   docker compose run --rm --no-deps -e NODE_EXTRA_CA_CERTS=... --entrypoint node load \
//     src/load/http2-check.ts https://caddy:8443 10

import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { connect, type ClientHttp2Session, type IncomingHttpHeaders } from 'node:http2';
import { setTimeout as sleep } from 'node:timers/promises';

const url = new URL(process.argv[2] ?? 'https://caddy:8443');
const streamCount = Number(process.argv[3] ?? 10);
const seconds = 5;

const session = connect(url);
await once(session, 'connect');
const alpn = session.alpnProtocol;

const stats = await getJson(session, '/api/stats');
const altSvc = stats.headers['alt-svc'];

// N event streams and the placements that feed them, all on this one TCP connection.
const messages = new Array<number>(streamCount).fill(0);
const streams = messages.map((_, i) => {
  const stream = session.request({ ':path': '/api/sse' });
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => (messages[i] += chunk.match(/^data: /gm)?.length ?? 0));
  return stream;
});
let placed = 0;
const writer = setInterval(() => {
  const stream = session.request({ ':method': 'POST', ':path': '/api/place' });
  stream.end(JSON.stringify({ x: placed % 64, y: 0, color: placed % 8 }));
  stream.resume();
  placed++;
}, 100);
await sleep(seconds * 1_000);
clearInterval(writer);
const during = await getJson(session, '/api/stats');
for (const stream of streams) stream.close();
session.close();

const result = {
  url: url.href,
  alpn,
  altSvc: altSvc ?? null,
  streams: streamCount,
  seconds,
  placed,
  messagesPerStream: messages,
  // Behind the proxy every stream is its own HTTP/1.1 connection to Node.
  sseConnectionsAtServer: (during.body as { connections: { sse: number } }).connections.sse,
};
console.log(JSON.stringify(result, null, 2));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
await writeFile(`results/${stamp}-t6-http2-check.json`, `${JSON.stringify(result, null, 2)}\n`);
process.exit(0);

async function getJson(
  http2: ClientHttp2Session,
  path: string
): Promise<{ headers: IncomingHttpHeaders; body: unknown }> {
  const stream = http2.request({ ':path': path });
  const [headers] = (await once(stream, 'response')) as [IncomingHttpHeaders];
  stream.setEncoding('utf8');
  let text = '';
  for await (const chunk of stream) text += chunk;
  return { headers, body: JSON.parse(text) };
}
