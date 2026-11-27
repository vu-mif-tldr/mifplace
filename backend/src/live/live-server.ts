import type { Server } from 'node:http';
import type { SessionsEnded } from '../auth/sessions.js';
import { Broadcaster, type LiveEvent } from './broadcaster.js';
import { catchUp } from './catch-up.js';
import { OnlineAnnouncer } from './online.js';
import {
  RESET,
  encodeOnline,
  parseResumeRequest,
  type Checkpoint,
  type PixelEvent,
} from './protocol.js';
import type { Connection } from './registry.js';
import { attachLiveTransport, type LiveTransportOptions } from './transport.js';

export type LiveServerOptions = Omit<
  LiveTransportOptions,
  'onConnect' | 'onMessage' | 'onDisconnect'
> & {
  // Pixels stored within this many ms go out as one message (docs/api.md: 100)
  batchMs: number;
  // A client more events behind than this gets reset instead of the missed events
  maxBacklog: number;
  // The number of connected pages goes out at most once per this many ms
  onlineMs: number;
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

// The close code of a connection whose session ended (docs/api.md): 4000-4999 are for
// applications, 4401 echoes HTTP 401
export const SIGNED_OUT_CODE = 4401;

// What GET /health reports under WS
export type LiveStats = { open: number; slowDropped: number; terminated: number };

export interface LiveServer {
  // Called right after a pixel is stored and applied to memory
  publish(event: LiveEvent): void;
  stats(): LiveStats;
  // Closes the live connections of sessions that ended (sign-out, a new password, a block)
  // with code 4401; the page then finds out it is signed out. Returns how many were closed.
  endSessions(ended: SessionsEnded): number;
  // Stops the batches and the liveness check, closes every client with 1001
  close(): void;
}

// The live side of the server (docs/api.md, section 2): the transport (gateway, registry,
// liveness check) and the broadcaster together. A client that connects with a checkpoint gets
// the events it missed from the log first (catchUp), then the batches like everyone else.
export function startLiveServer(
  server: Server,
  log: LiveLog,
  { batchMs, maxBacklog, onlineMs, ...transportOptions }: LiveServerOptions
): LiveServer {
  const transport = attachLiveTransport(server, {
    ...transportOptions,

    // Registration and the first message happen in one synchronous step, so no batch can
    // slip in between (the broadcaster sends from a timer, never from here).
    onConnect(connection, url) {
      if (resume(connection, url)) {
        // The new page learns the count at once, everyone else with the next announcement
        transport.registry.send(connection, encodeOnline(open()));
      }
      online.changed();
    },

    onDisconnect() {
      online.changed();
    },

    // Clients send nothing over the socket (docs/api.md), placements go through POST /api/pixels
    onMessage(connection) {
      transport.registry.close(connection, 1003, 'Clients send nothing');
    },
  });

  // Sends what a connecting client missed. False if it was reset: that connection is closing.
  function resume(connection: Connection, url: URL): boolean {
    const request = parseResumeRequest(url.searchParams);
    if (request.kind === 'live') return true; // only new batches, no history
    if (request.kind === 'invalid') {
      reset(connection);
      return false;
    }
    const result = catchUp(request.after, {
      lastSent: broadcaster.lastSent,
      timestampOf: log.timestampOf,
      eventsBetween: log.eventsBetween,
      maxBacklog,
    });
    if (result.kind === 'reset') {
      reset(connection);
      return false;
    }
    if (result.kind === 'events') transport.registry.send(connection, result.message);
    return true;
  }

  const open = () => transport.registry.stats().open;

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

  const online = new OnlineAnnouncer({ intervalMs: onlineMs }, open, (data) =>
    transport.registry.broadcast(data)
  );

  return {
    publish: (event) => broadcaster.publish(event),
    stats: () => transport.registry.stats(),
    endSessions(ended) {
      return transport.registry.closeWhere(
        ({ owner }) =>
          owner !== undefined &&
          ('session' in ended
            ? owner.session === ended.session
            : owner.userId === ended.userId && owner.session !== ended.exceptSession),
        SIGNED_OUT_CODE,
        'Signed out'
      );
    },
    close() {
      broadcaster.close();
      online.close();
      transport.close();
    },
  };
}
