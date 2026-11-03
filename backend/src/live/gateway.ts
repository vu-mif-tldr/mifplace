import http, { type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';

export interface GatewayOptions {
  path: string;
  maxConnections: number;
  allowedOrigins: string[];
  maxPayload: number;
}

export function getClientIp(remoteIp: string, forwarded: string | string[] | undefined): string {
  const isLoopback =
    remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';

  // Trust forwarded headers only from a loopback peer.
  if (!isLoopback) {
    return remoteIp;
  }

  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;

  const firstIp = forwardedValue?.split(',')[0]?.trim();

  return firstIp || remoteIp;
}

export function attachGateway(
  server: http.Server,
  options: GatewayOptions,
  currentCount: () => number,
  onConnection: (ws: WebSocket, request: { ip: string; url: URL }) => void
): { close(): void } {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: options.maxPayload,
  });

  function reject(socket: Socket, status: number, message: string): void {
    if (!socket.writable) {
      socket.destroy();
      return;
    }

    socket.end(
      `HTTP/1.1 ${status} ${message}\r\n` +
        'Connection: close\r\n' +
        'Content-Length: 0\r\n' +
        '\r\n'
    );
  }

  function isAllowedOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;

    // Non-browser clients may omit Origin.
    if (origin === undefined) {
      return true;
    }

    const host = request.headers.host;

    if (!host) {
      return false;
    }

    try {
      const parsedOrigin = new URL(origin);

      if (
        !['http:', 'https:'].includes(parsedOrigin.protocol) ||
        parsedOrigin.username ||
        parsedOrigin.password ||
        parsedOrigin.pathname !== '/' ||
        parsedOrigin.search ||
        parsedOrigin.hash ||
        parsedOrigin.origin === 'null'
      ) {
        return false;
      }

      // Allow the page's own host.
      if (parsedOrigin.host.toLowerCase() === host.toLowerCase()) {
        return true;
      }

      // Allow explicitly configured additional origins.
      return options.allowedOrigins.some((allowed) => {
        try {
          return new URL(allowed).origin === parsedOrigin.origin;
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }

  function handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): void {
    let url: URL;

    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }

    // Reject upgrades on other paths.
    if (url.pathname !== options.path) {
      socket.destroy();
      return;
    }

    // Reject unauthorized origins.
    if (!isAllowedOrigin(request)) {
      reject(socket, 403, 'Forbidden');
      return;
    }

    // Enforce the connection limit.
    if (currentCount() >= options.maxConnections) {
      reject(socket, 503, 'Service Unavailable');
      return;
    }

    const ip = getClientIp(request.socket.remoteAddress ?? '', request.headers['x-forwarded-for']);

    wss.handleUpgrade(request, socket, head, (ws) => {
      // Prevent an unhandled WebSocket error when Gateway
      // is used without a ConnectionRegistry.
      //
      // If Registry has installed its own error listener,
      // Registry is responsible for terminating the socket
      // and updating its statistics.
      ws.on('error', () => {
        if (ws.listenerCount('error') === 1) {
          ws.terminate();
        }
      });

      onConnection(ws, { ip, url });
    });
  }

  server.on('upgrade', handleUpgrade);

  return {
    close(): void {
      server.off('upgrade', handleUpgrade);
      wss.close();
    },
  };
}
