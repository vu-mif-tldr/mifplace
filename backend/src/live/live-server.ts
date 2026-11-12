import type { Server } from 'node:http';
import { Broadcaster, type LiveEvent } from './broadcaster.js';
import { catchUp } from './catch-up.js';
import { RESET, parseResumeRequest, type Checkpoint, type PixelEvent } from './protocol.js';
import type { Connection } from './registry.js';
import { attachLiveTransport, type LiveTransportOptions } from './transport.js';

export type LiveServerOptions = Omit<LiveTransportOptions, 'onConnect' | 'onMessage'> & {
  // Pixels stored within this many ms go out as one message (docs/api.md: 100)
  batchMs: number;
  // A client more events behind than this gets reset instead of the missed events
  maxBacklog: number;
};

// What the live server reads from the event log: the canvas in memory and MifDb in production
export interface LiveLog {
  // The last stored event: where the stream begins at start
  checkpoint(): Checkpoint;
  // The timestamp of a stored event, undefined for an unknown id
  timestampOf(eventId: number): number | undefined;
  // The stored events with ids in (afterId, toId], in order
  eventsBetween(afterId: number, toId: number): PixelEvent[];
}

// What GET /health reports under WS
export type LiveStats = { open: number; slowDropped: number; terminated: number };

export interface LiveServer {
  // Called right after a pixel is stored and applied to memory
  publish(event: LiveEvent): void;
  stats(): LiveStats;
  // Stops the batches and the liveness check, closes every client with 1001
  close(): void;
}

// The live side of the server (docs/api.md, section 2): the transport (gateway, registry,
// liveness check) and the broadcaster together. A client that connects with a checkpoint gets
// the events it missed from the log first (catchUp), then the batches like everyone else.
export function startLiveServer(
  server: Server,
  log: LiveLog,
  { batchMs, maxBacklog, ...transportOptions }: LiveServerOptions
): LiveServer {
  const transport = attachLiveTransport(server, {
    ...transportOptions,

    // Registration and the first message happen in one synchronous step, so no batch can
    // slip in between (the broadcaster sends from a timer, never from here).
    onConnect(connection, url) {
      const request = parseResumeRequest(url.searchParams);
      if (request.kind === 'live') return; // only new batches, no history
      if (request.kind === 'invalid') {
        reset(connection);
        return;
      }
      const result = catchUp(request.after, {
        lastSent: broadcaster.lastSent,
        timestampOf: log.timestampOf,
        eventsBetween: log.eventsBetween,
        maxBacklog,
      });
      if (result.kind === 'reset') reset(connection);
      else if (result.kind === 'events') transport.registry.send(connection, result.message);
    },

    // Clients send nothing over the socket (docs/api.md), placements go through POST /api/pixels
    onMessage(connection) {
      transport.registry.close(connection, 1003, 'Clients send nothing');
    },
  });

  // The client loads a new snapshot and connects again (docs/api.md), so this connection is of
  // no use: closing it keeps the next batches from going to a client that would discard them.
  function reset(connection: Connection): void {
    transport.registry.send(connection, RESET);
    transport.registry.close(connection, 1000, 'Cannot resume from this checkpoint');
  }

  const broadcaster = new Broadcaster(
    { batchMs },
    (data) => transport.registry.broadcast(data),
    log.checkpoint()
  );

  return {
    publish: (event) => broadcaster.publish(event),
    stats: () => transport.registry.stats(),
    close() {
      broadcaster.close();
      transport.close();
    },
  };
}
