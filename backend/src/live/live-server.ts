import type { Server } from 'node:http';
import { Broadcaster, type LiveEvent } from './broadcaster.js';
import { RESET, parseResumeRequest, type Checkpoint } from './protocol.js';
import type { Connection } from './registry.js';
import { attachLiveTransport, type LiveTransportOptions } from './transport.js';

export type LiveServerOptions = Omit<LiveTransportOptions, 'onConnect' | 'onMessage'> & {
  // Pixels stored within this many ms go out as one message (docs/api.md: 100)
  batchMs: number;
};

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
// liveness check) and the broadcaster together. checkpoint gives the last stored event: at start
// it is where the stream begins, later it tells whether a client's checkpoint is from this log.
export function startLiveServer(
  server: Server,
  checkpoint: () => Checkpoint,
  { batchMs, ...transportOptions }: LiveServerOptions
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
      // A checkpoint ahead of the last stored event, or the same id with another time, is not
      // from this log (a restored database, ADR-0003 R2): the client has to start over.
      const { after } = request;
      const last = checkpoint();
      if (
        after.eventId > last.eventId ||
        (after.eventId === last.eventId && after.timestamp !== last.timestamp)
      ) {
        reset(connection);
        return;
      }
      // TODO(MP-89): catch up from the checkpoint. Until then a client behind the last stored
      // event gets only the next batches, and misses the events between its snapshot and now.
      // Events stored but not yet sent are in the next batch anyway (the client skips the ones
      // up to its checkpoint).
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
    checkpoint()
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
