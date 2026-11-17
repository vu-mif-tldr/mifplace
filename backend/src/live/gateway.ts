import http, { type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { isAllowedOrigin } from '../origin.js';
import type { ConnectionOwner } from './registry.js';

export interface GatewayOptions {
  path: string;
  maxConnections: number;
  allowedOrigins: string[];
  maxPayload: number;
  // Who the upgrade request comes from, by its Cookie header; undefined refuses it with 401.
  // Left out, anyone may connect (a server without accounts).
  authenticate?: (cookieHeader: string | undefined) => ConnectionOwner | undefined;
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
  onConnection: (ws: WebSocket, request: { ip: string; url: URL; owner?: ConnectionOwner }) => void
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
    if (!isAllowedOrigin(request.headers.origin, request.headers.host, options.allowedOrigins)) {
      reject(socket, 403, 'Forbidden');
      return;
    }

    // Only a signed-in visitor may connect. The browser sends the session cookie with the
    // upgrade request by itself.
    const owner = options.authenticate?.(request.headers.cookie);
    if (options.authenticate && !owner) {
      reject(socket, 401, 'Unauthorized');
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

      onConnection(ws, { ip, url, owner });
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
