import type { Server } from 'node:http';
import {
  DEFAULT_CHECK_INTERVAL_MS,
  DEFAULT_IDLE_MS,
  DEFAULT_PONG_TIMEOUT_MS,
  LivenessTracker,
  startLivenessCheck,
} from './liveness.js';
import { attachGateway, type GatewayOptions } from './gateway.js';
import { ConnectionRegistry, type Connection } from './registry.js';

export interface LiveTransportOptions extends GatewayOptions {
  maxBufferedBytes: number;
  liveness?: {
    idleMs: number;
    pongTimeoutMs: number;
    intervalMs: number;
  };
}

export function attachLiveTransport(
  server: Server,
  options: LiveTransportOptions
): {
  registry: ConnectionRegistry;
  close(): void;
} {
  const connections = new Map<number, Connection>();

  const liveness = options.liveness ?? {
    idleMs: DEFAULT_IDLE_MS,
    pongTimeoutMs: DEFAULT_PONG_TIMEOUT_MS,
    intervalMs: DEFAULT_CHECK_INTERVAL_MS,
  };

  const tracker = new LivenessTracker({
    idleMs: liveness.idleMs,
    pongTimeoutMs: liveness.pongTimeoutMs,
  });

  const registry = new ConnectionRegistry(
    { maxBufferedBytes: options.maxBufferedBytes },
    {
      onActivity(connection) {
        tracker.touch(connection.id, Date.now());
      },

      onClose(connection) {
        tracker.forget(connection.id);
        connections.delete(connection.id);
      },
    }
  );

  const livenessCheck = startLivenessCheck({
    intervalMs: liveness.intervalMs,
    tracker,

    ping(id) {
      const connection = connections.get(id);

      if (connection) {
        registry.ping(connection);
      }
    },

    terminate(id) {
      const connection = connections.get(id);

      if (connection) {
        registry.terminate(connection);
      }
    },
  });

  let closed = false;

  const gateway = attachGateway(
    server,
    options,
    () => registry.size,
    (ws, request) => {
      if (closed) {
        ws.close(1001, 'Server shutting down');
        return;
      }

      const connection = registry.add(ws, request.ip);

      connections.set(connection.id, connection);
      tracker.touch(connection.id, Date.now());
    }
  );

  return {
    registry,

    close(): void {
      if (closed) return;
      closed = true;

      gateway.close();
      livenessCheck.stop();

      registry.closeAll(1001, 'Server shutting down');

      const timer = setTimeout(() => {
        for (const connection of connections.values()) {
          registry.terminate(connection);
        }
      }, 2_000);

      timer.unref();
    },
  };
}
