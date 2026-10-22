import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseCursor } from '../../shared/protocol.ts';
import type { Hub, PushClient } from '../hub.ts';

export interface SseOptions {
  /** A client with more unsent data than this is too slow and gets disconnected. */
  maxBufferedBytes: number;
  /** Range for the `retry:` field, the browser's own reconnect delay. */
  retryMinMs: number;
  retryMaxMs: number;
}

/** GET /api/sse?after=<cursor>: a one-way stream of batches. Placements go through POST /api/place. */
export function handleSse(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  hub: Hub,
  options: SseOptions
): void {
  // When EventSource reconnects by itself it sends the last `id:` it received. The query
  // parameter only covers the first connection, made right after loading the snapshot.
  const lastEventId = req.headers['last-event-id'];
  const after = parseCursor(
    typeof lastEventId === 'string' ? lastEventId : url.searchParams.get('after')
  );

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Asks nginx-style proxies not to buffer the stream.
    'X-Accel-Buffering': 'no',
  });
  res.socket?.setNoDelay(true);
  // EventSource waits exactly `retry` ms before reconnecting, without jitter of its own. A random
  // value per connection spreads the reconnects of all clients after a server restart.
  const { retryMinMs, retryMaxMs, maxBufferedBytes } = options;
  res.write(`retry: ${retryMinMs + Math.floor(Math.random() * (retryMaxMs - retryMinMs))}\n\n`);

  const client: PushClient = {
    kind: 'sse',
    send(payload, cursor) {
      // Do not buffer without limit for a slow client: drop it, it catches up after reconnecting.
      if (res.writableLength > maxBufferedBytes) {
        hub.counters.slowClientsDropped++;
        res.destroy();
        return;
      }
      res.write(
        cursor === undefined ? `data: ${payload}\n\n` : `id: ${cursor}\ndata: ${payload}\n\n`
      );
    },
    close: () => res.destroy(),
  };
  hub.connect(client, after);
  res.on('close', () => hub.disconnect(client));
}
