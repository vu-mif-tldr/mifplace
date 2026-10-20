import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CANVAS_HEADER_BYTES,
  CANVAS_FORMAT_VERSION,
  EMPTY_CELL,
  decodeMessage,
  encodeEvents,
  encodeReload,
  parseCanvas,
  readLastEventId,
  writeCanvasHeader,
  writeLastEventId,
} from './index.js';

// A standalone ArrayBuffer, as a browser receives it.
const standalone = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;

describe('live messages', () => {
  it('writes the type, the count and 9 bytes per event, and reads them back', () => {
    const events = [
      { id: 70000, position: 5, color_id: 3 },
      { id: 70002, position: 65536, color_id: 0 },
    ];
    const bytes = encodeEvents(events);
    assert.equal(bytes.length, 5 + 2 * 9);
    assert.deepEqual([...bytes.subarray(0, 5)], [1, 2, 0, 0, 0]);
    assert.deepEqual(decodeMessage(standalone(bytes)), { type: 'events', events });
  });

  it('encodes and decodes the reload message', () => {
    assert.deepEqual([...encodeReload()], [2]);
    assert.deepEqual(decodeMessage(standalone(encodeReload())), { type: 'reload' });
  });

  it('rejects an unknown type and a wrong length', () => {
    assert.throws(() => decodeMessage(new Uint8Array([9]).buffer), /unknown message type 9/);
    const bytes = encodeEvents([{ id: 1, position: 1, color_id: 1 }]);
    assert.throws(() => decodeMessage(standalone(bytes.subarray(0, 8))), /bytes for 1 events/);
  });
});

describe('canvas body', () => {
  function body(): Uint8Array {
    const bytes = new Uint8Array(CANVAS_HEADER_BYTES + 6).fill(EMPTY_CELL);
    writeCanvasHeader(bytes, { width: 3, height: 2, lastEventId: 42 });
    bytes[CANVAS_HEADER_BYTES + 4] = 7;
    return bytes;
  }

  it('writes the documented header layout', () => {
    assert.deepEqual(
      [...body().subarray(0, CANVAS_HEADER_BYTES)],
      [CANVAS_FORMAT_VERSION, 3, 0, 0, 0, 2, 0, 0, 0, 42, 0, 0, 0]
    );
  });

  it('reads back what was written', () => {
    const snapshot = parseCanvas(standalone(body()));
    assert.deepEqual(
      { w: snapshot.width, h: snapshot.height, id: snapshot.lastEventId },
      { w: 3, h: 2, id: 42 }
    );
    assert.deepEqual([...snapshot.cells], [255, 255, 255, 255, 7, 255]);
  });

  it('updates the last event id in place, also in a view with an offset', () => {
    const bytes = body();
    writeLastEventId(bytes, 43);
    assert.equal(readLastEventId(bytes), 43);
    const padded = new Uint8Array(bytes.length + 3);
    padded.set(bytes, 3);
    const shifted = padded.subarray(3);
    writeLastEventId(shifted, 44);
    assert.equal(readLastEventId(shifted), 44);
  });

  it('rejects a short body, another version and a wrong cell count', () => {
    assert.throws(() => parseCanvas(new ArrayBuffer(5)), /too short/);
    const other = body();
    other[0] = 9;
    assert.throws(() => parseCanvas(standalone(other)), /format version 9/);
    assert.throws(() => parseCanvas(standalone(body().subarray(0, 16))), /expected 3x2=6/);
  });
});
