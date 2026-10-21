import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventLog } from '../src/server/event-log.ts';
import { Hub, type PushClient, type Waiter } from '../src/server/hub.ts';
import type { ServerMessage } from '../src/shared/protocol.ts';

// The timers are never started: the tests call flush() themselves.
const OPTIONS = { batchMs: 1_000, heartbeatMs: 1_000, maxBacklog: 10 };

function setup() {
  const log = new EventLog();
  const hub = new Hub(log, OPTIONS);
  const place = (count: number) => {
    for (let i = 0; i < count; i++) assert.ok(log.place({ x: i % 64, y: 0, color: 1 }).ok);
  };
  return { log, hub, place };
}

function recorder(): PushClient & { received: { message: ServerMessage; lastId?: number }[] } {
  const received: { message: ServerMessage; lastId?: number }[] = [];
  return {
    kind: 'ws',
    received,
    send: (payload, lastId) => received.push({ message: JSON.parse(payload), lastId }),
    close: () => {},
  };
}

function ids(message: ServerMessage): number[] {
  assert.equal(message.t, 'batch');
  return message.t === 'batch' ? message.events.map(([id]) => id) : [];
}

describe('Hub.catchUp', () => {
  it('returns nothing to a client that is up to date or ahead of the last batch', () => {
    const { hub, place } = setup();
    place(3);
    hub.flush();
    place(2);
    assert.equal(hub.catchUp(3), null);
    assert.equal(hub.catchUp(5), null);
  });

  it('returns the flushed events after the given id, not the unflushed ones', () => {
    const { hub, place } = setup();
    place(3);
    hub.flush();
    place(2);
    const missed = hub.catchUp(1);
    assert.ok(missed !== null && missed !== 'reset');
    assert.deepEqual(ids(JSON.parse(missed.payload)), [2, 3]);
    assert.equal(missed.toId, 3);
  });

  it('asks for a reset for an id the server never issued', () => {
    const { hub, place } = setup();
    place(3);
    hub.flush();
    assert.equal(hub.catchUp(4), 'reset');
    assert.equal(hub.catchUp(-1), 'reset');
  });

  it('asks for a reset when the backlog is longer than maxBacklog', () => {
    const { hub, place } = setup();
    place(20);
    hub.flush();
    assert.equal(hub.catchUp(9), 'reset');
    assert.notEqual(hub.catchUp(10), 'reset');
  });
});

describe('Hub.flush', () => {
  it('sends every new event exactly once to every client', () => {
    const { hub, place } = setup();
    const [a, b] = [recorder(), recorder()];
    hub.connect(a, 0);
    hub.connect(b, 0);
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
        client.received.map(({ lastId }) => lastId),
        [2, 3]
      );
    }
  });

  it('sends a late client its backlog first, then the following batches', () => {
    const { hub, place } = setup();
    place(2);
    hub.flush();
    const client = recorder();
    hub.connect(client, 0);
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
    hub.connect(client, 7);
    assert.deepEqual(client.received, [{ message: { t: 'reset' }, lastId: undefined }]);
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
