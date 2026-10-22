import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { EventLog } from '../src/server/event-log.ts';
import { Hub, type PushClient, type Waiter } from '../src/server/hub.ts';
import {
  START,
  formatCursor,
  parseCursor,
  type Cursor,
  type ServerMessage,
} from '../src/shared/protocol.ts';

// The timers are never started: the tests call flush() themselves.
const OPTIONS = { batchMs: 1_000, heartbeatMs: 1_000, maxBacklog: 10 };

function setup() {
  const log = new EventLog();
  const hub = new Hub(log, OPTIONS);
  const place = (count: number) => {
    for (let i = 0; i < count; i++) assert.ok(log.place({ x: i % 64, y: 0, color: 1 }).ok);
  };
  /** The cursor of a client whose last event is `id` of this log. */
  const at = (id: number): Cursor => ({ id, ts: log.tsOf(id) ?? 0 });
  return { log, hub, place, at };
}

function recorder(): PushClient & { received: { message: ServerMessage; cursor?: string }[] } {
  const received: { message: ServerMessage; cursor?: string }[] = [];
  return {
    kind: 'ws',
    received,
    send: (payload, cursor) => received.push({ message: JSON.parse(payload), cursor }),
    close: () => {},
  };
}

function ids(message: ServerMessage): number[] {
  assert.equal(message.t, 'batch');
  return message.t === 'batch' ? message.events.map(([id]) => id) : [];
}

describe('cursors', () => {
  it('round-trip, and anything malformed is null', () => {
    assert.deepEqual(parseCursor(formatCursor({ id: 12, ts: 1_700_000_000_000 })), {
      id: 12,
      ts: 1_700_000_000_000,
    });
    assert.deepEqual(parseCursor(null), START);
    assert.equal(parseCursor('12'), null);
    assert.equal(parseCursor('-1:5'), null);
  });
});

describe('Hub.catchUp', () => {
  it('returns nothing to a client that is up to date or ahead of the last batch', () => {
    const { hub, place, at } = setup();
    place(3);
    hub.flush();
    place(2);
    assert.equal(hub.catchUp(at(3)), null);
    assert.equal(hub.catchUp(at(5)), null);
  });

  it('returns the flushed events after the cursor, not the unflushed ones', () => {
    const { hub, place, at } = setup();
    place(3);
    hub.flush();
    place(2);
    const missed = hub.catchUp(at(1));
    assert.ok(missed !== null && missed !== 'reset');
    assert.deepEqual(ids(JSON.parse(missed.payload)), [2, 3]);
    assert.equal(missed.cursor, formatCursor(at(3)));
  });

  it('asks for a reset for an id the server never issued, or a malformed cursor', () => {
    const { hub, place } = setup();
    place(3);
    hub.flush();
    assert.equal(hub.catchUp({ id: 4, ts: 1 }), 'reset');
    assert.equal(hub.catchUp(null), 'reset');
  });

  it('asks for a reset when the id belongs to another log', () => {
    // A restart that lost the log, or a restore from a backup: id 2 now names another event.
    const { hub, place, at } = setup();
    place(3);
    hub.flush();
    assert.equal(hub.catchUp({ id: 2, ts: at(2).ts - 1 }), 'reset');
  });

  it('asks for a reset when the backlog is longer than maxBacklog', () => {
    const { hub, place, at } = setup();
    place(20);
    hub.flush();
    assert.equal(hub.catchUp(at(9)), 'reset');
    assert.notEqual(hub.catchUp(at(10)), 'reset');
  });
});

describe('Hub.flush', () => {
  it('sends every new event exactly once to every client', () => {
    const { hub, place, at } = setup();
    const [a, b] = [recorder(), recorder()];
    hub.connect(a, START);
    hub.connect(b, START);
    place(2);
    hub.flush();
    place(1);
    hub.flush();
    hub.flush();
    for (const client of [a, b]) {
      assert.deepEqual(
        client.received.map(({ message }) => ids(message)),
        [[1, 2], [3]]
      );
      assert.deepEqual(
        client.received.map(({ cursor }) => cursor),
        [formatCursor(at(2)), formatCursor(at(3))]
      );
    }
  });

  it('sends a late client its backlog first, then the following batches', () => {
    const { hub, place } = setup();
    place(2);
    hub.flush();
    const client = recorder();
    hub.connect(client, START);
    place(1);
    hub.flush();
    assert.deepEqual(
      client.received.map(({ message }) => ids(message)),
      [[1, 2], [3]]
    );
  });

  it('tells a client of a restarted server to reset', () => {
    const { hub } = setup();
    const client = recorder();
    hub.connect(client, { id: 7, ts: 1 });
    assert.deepEqual(client.received, [{ message: { t: 'reset' }, cursor: undefined }]);
  });

  it('wakes each parked long poll once', () => {
    const { hub, place } = setup();
    let wakes = 0;
    const waiter: Waiter = { wake: () => wakes++, close: () => {} };
    hub.wait(waiter);
    place(1);
    hub.flush();
    place(1);
    hub.flush();
    assert.equal(wakes, 1);
  });
});

describe('Hub after a restart with a kept log', () => {
  it('sends only new events, and the old ones only to clients that miss them', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hub-restart-'));
    const file = path.join(dir, 'events.jsonl');
    const before = new EventLog(file);
    for (let i = 0; i < 5; i++) before.place({ x: i, y: 0, color: 1 });

    const log = new EventLog(file);
    const hub = new Hub(log, OPTIONS);
    const [current, behind] = [recorder(), recorder()];
    hub.connect(current, { id: 5, ts: log.tsOf(5) ?? 0 });
    hub.connect(behind, { id: 3, ts: log.tsOf(3) ?? 0 });
    log.place({ x: 9, y: 9, color: 2 });
    hub.flush();
    assert.deepEqual(
      current.received.map(({ message }) => ids(message)),
      [[6]]
    );
    assert.deepEqual(
      behind.received.map(({ message }) => ids(message)),
      [[4, 5], [6]]
    );
  });
});

describe('Hub.dropRandom', () => {
  it('closes the given number of connections and forgets them', () => {
    const { hub } = setup();
    let closed = 0;
    for (let i = 0; i < 5; i++) hub.connect({ ...recorder(), close: () => closed++ }, START);
    assert.equal(hub.dropRandom(2), 2);
    assert.equal(closed, 2);
    assert.equal(hub.counts().ws, 3);
    assert.equal(hub.dropRandom(10), 3);
    assert.equal(hub.counts().ws, 0);
  });
});

describe('EventLog with a file', () => {
  it('reads its events back after a restart', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'event-log-'));
    const file = path.join(dir, 'nested', 'events.jsonl');
    const before = new EventLog(file);
    assert.ok(before.place({ x: 1, y: 2, color: 3 }).ok);
    assert.ok(before.place({ x: 1, y: 2, color: 4 }).ok);

    const after = new EventLog(file);
    assert.equal(after.lastId, 2);
    assert.deepEqual(after.range(0, 2), before.range(0, 2));
    assert.equal(after.snapshot().cells[2 * 64 + 1], 4);
    assert.equal(after.snapshot().lastEventTs, before.tsOf(2));
    assert.equal(after.place({ x: 0, y: 0, color: 0 }).ok && after.lastId, 3);
  });
});
