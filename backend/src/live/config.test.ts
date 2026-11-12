import { describe, expect, it } from 'vitest';
import { liveOptionsFromEnv } from './config.js';

describe('liveOptionsFromEnv', () => {
  it('uses the defaults of docs/api.md when nothing is set', () => {
    expect(liveOptionsFromEnv({})).toEqual({
      path: '/api/ws',
      maxPayload: 1024,
      batchMs: 100,
      maxConnections: 2000,
      maxBacklog: 10000,
      maxBufferedBytes: 262144,
      allowedOrigins: [],
      liveness: { idleMs: 15000, pongTimeoutMs: 10000, intervalMs: 5000 },
    });
  });

  it('treats an empty value as unset', () => {
    expect(liveOptionsFromEnv({ WS_BATCH_MS: '', WS_ALLOWED_ORIGINS: '' })).toMatchObject({
      batchMs: 100,
      allowedOrigins: [],
    });
  });

  it('reads every setting', () => {
    expect(
      liveOptionsFromEnv({
        WS_BATCH_MS: '50',
        WS_IDLE_PING_MS: '1000',
        WS_PONG_TIMEOUT_MS: '2000',
        WS_LIVENESS_CHECK_MS: '500',
        WS_MAX_CONNECTIONS: '10',
        WS_MAX_BACKLOG: '500',
        WS_MAX_BUFFERED_BYTES: '4096',
        WS_ALLOWED_ORIGINS: ' https://vu.place, http://localhost:5173 ,',
      })
    ).toEqual({
      path: '/api/ws',
      maxPayload: 1024,
      batchMs: 50,
      maxConnections: 10,
      maxBacklog: 500,
      maxBufferedBytes: 4096,
      allowedOrigins: ['https://vu.place', 'http://localhost:5173'],
      liveness: { idleMs: 1000, pongTimeoutMs: 2000, intervalMs: 500 },
    });
  });

  it.each(['0', '-1', '1.5', '1e3', ' 1', 'abc', String(Number.MAX_SAFE_INTEGER + 1)])(
    'rejects "%s" with the name of the setting',
    (value) => {
      expect(() => liveOptionsFromEnv({ WS_MAX_CONNECTIONS: value })).toThrow(
        `Invalid WS_MAX_CONNECTIONS: ${value}`
      );
    }
  );
});
