import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { MifDb, configureDb } from './db.js';
import {
  LiveUpdates,
  MESSAGE_EVENTS,
  MESSAGE_RELOAD,
  encodeEvents,
  type LiveEvent,
  type LiveUpdatesOptions,
} from './live-updates.js';
import { loadMigrations, migrate } from './scripts/migrate.js';
import { setLogLevel } from './log.js';

// The code under test logs every connection and file, the test output does not need it.
setLogLevel('error');

const REAL_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

type Message = { type: 'events'; events: LiveEvent[] } | { type: 'reload' };

// The client side of the protocol, kept here so the test does not depend on the frontend.
function decode(data: ArrayBuffer): Message {
  const view = new DataView(data);
  const type = view.getUint8(0);
  if (type === MESSAGE_RELOAD) return { type: 'reload' };
  assert.equal(type, MESSAGE_EVENTS);
  const count = view.getUint32(1, true);
  const events: LiveEvent[] = [];
  for (let i = 0; i < count; i++) {
    const offset = 5 + i * 9;
    events.push({
      id: view.getUint32(offset, true),
      position: view.getUint32(offset + 4, true),
      color_id: view.getUint8(offset + 8),
    });
  }
  return { type: 'events', events };
}

// A browser-like client that records every message and the close code.
class Client {
  readonly messages: Message[] = [];
  closeCode: number | undefined;
  private readonly ws: WebSocket;
  private waiters: (() => void)[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (e) => {
      this.messages.push(decode(e.data as ArrayBuffer));
      this.wake();
    };
    this.ws.onclose = (e) => {
      this.closeCode = e.code;
      this.wake();
    };
    this.ws.onerror = () => this.wake();
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', () => reject(new Error('connection failed')));
    });
  }

  // Waits until the condition holds, fails after a second.
  async until(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 1000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('timeout');
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 20);
      });
    }
  }

  close(): void {
    this.ws.close();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}

describe('encodeEvents', () => {
  it('writes the type, the count and 9 bytes per event', () => {
    const events = [
      { id: 70000, position: 5, color_id: 3 },
      { id: 70002, position: 65536, color_id: 0 },
    ];
    const buf = encodeEvents(events);
    assert.equal(buf.length, 5 + 2 * 9);
    // Copy into a standalone ArrayBuffer, as the browser receives it.
    assert.deepEqual(decode(new Uint8Array(buf).buffer), { type: 'events', events });
  });
});

describe('LiveUpdates', () => {
  let cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
    cleanup = [];
  });

  // A migrated database with `count` events, a server with LiveUpdates started after them.
  async function start(count: number, options: Partial<LiveUpdatesOptions> = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mifplace-test-'));
    const db = configureDb(new Database(path.join(dir, 't.db')));
    migrate(db, loadMigrations(REAL_MIGRATIONS_DIR));
    const mif = new MifDb(db);
    for (let i = 0; i < count; i++) mif.appendEvent({ user_id: 0, color_id: i % 8, position: i });

    const live = new LiveUpdates(mif, mif.getLastEventId(), { batchMs: 10, ...options });
    const server = http.createServer();
    server.on('upgrade', (req, socket, head) => live.handleUpgrade(req, socket, head));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    const clients: Client[] = [];
    cleanup.push(async () => {
      for (const c of clients) c.close();
      live.close();
      await new Promise((resolve) => server.close(resolve));
      db.close();
      fs.rmSync(dir, { recursive: true });
    });

    // Appends an event the way POST /api/pixel does.
    const place = (position: number, color_id: number): number => {
      const id = mif.appendEvent({ user_id: 0, color_id, position });
      live.publish({ id, position, color_id });
      return id;
    };
    const connect = async (after: number | string): Promise<Client> => {
      const client = new Client(`ws://127.0.0.1:${port}/api/ws?after=${after}`);
      clients.push(client);
      await client.opened();
      return client;
    };
    return { live, place, connect };
  }

  it('sends the missed events on connect, then new ones in batches', async () => {
    const { place, connect } = await start(3);
    const client = await connect(1);
    await client.until(() => client.messages.length === 1);
    assert.deepEqual(client.messages[0], {
      type: 'events',
      events: [
        { id: 2, position: 1, color_id: 1 },
        { id: 3, position: 2, color_id: 2 },
      ],
    });

    place(10, 4);
    place(11, 5);
    await client.until(() => client.messages.length === 2);
    assert.deepEqual(client.messages[1], {
      type: 'events',
      events: [
        { id: 4, position: 10, color_id: 4 },
        { id: 5, position: 11, color_id: 5 },
      ],
    });
  });

  it('sends nothing on connect to a client that is up to date', async () => {
    const { live, connect } = await start(3);
    const client = await connect(3);
    await client.until(() => live.clientCount === 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(client.messages, []);
  });

  it('a pending event reaches a new client once, with the next batch', async () => {
    // The event is stored but not broadcast yet: it is not in the catch-up, only in the batch.
    const { place, connect } = await start(1, { batchMs: 100 });
    const id = place(7, 3);
    const client = await connect(1);
    await client.until(() => client.messages.length === 1);
    assert.deepEqual(client.messages[0], {
      type: 'events',
      events: [{ id, position: 7, color_id: 3 }],
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(client.messages.length, 1);
  });

  it('tells a client that is too far behind or from the future to reload', async () => {
    const { connect } = await start(5, { maxCatchUp: 2 });
    for (const after of [0, 99]) {
      const client = await connect(after);
      await client.until(() => client.closeCode !== undefined);
      assert.deepEqual(client.messages, [{ type: 'reload' }]);
      assert.equal(client.closeCode, 1000);
    }
  });

  it('rejects a connection without a valid after', async () => {
    const { connect } = await start(0);
    for (const after of ['', '-1', '1.5', 'x', '1e3']) {
      await assert.rejects(connect(after), /connection failed/);
    }
  });
});
