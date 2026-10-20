// Messages of /api/ws, server -> client, binary, little-endian. The client sends nothing.
//   EVENTS: [type u8 = 1][count u32] + count x [id u32][position u32][color_id u8], ids ascending
//   RELOAD: [type u8 = 2], the client must load GET /api/canvas again and reconnect after its id
// The client applies only events with an id above the last one it has: the snapshot may
// already contain events of the next EVENTS message.

export const MESSAGE_EVENTS = 1;
export const MESSAGE_RELOAD = 2;
const EVENTS_HEADER_BYTES = 5;
export const EVENT_BYTES = 9;

export interface LiveEvent {
  id: number;
  position: number;
  color_id: number;
}

export type LiveMessage = { type: 'events'; events: LiveEvent[] } | { type: 'reload' };

export function encodeEvents(events: readonly LiveEvent[]): Uint8Array {
  const bytes = new Uint8Array(EVENTS_HEADER_BYTES + events.length * EVENT_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, MESSAGE_EVENTS);
  view.setUint32(1, events.length, true);
  events.forEach((e, i) => {
    const offset = EVENTS_HEADER_BYTES + i * EVENT_BYTES;
    view.setUint32(offset, e.id, true);
    view.setUint32(offset + 4, e.position, true);
    view.setUint8(offset + 8, e.color_id);
  });
  return bytes;
}

export function encodeReload(): Uint8Array {
  return new Uint8Array([MESSAGE_RELOAD]);
}

export function decodeMessage(data: ArrayBuffer): LiveMessage {
  const view = new DataView(data);
  const type = view.getUint8(0);
  if (type === MESSAGE_RELOAD) return { type: 'reload' };
  if (type !== MESSAGE_EVENTS) throw new Error(`Live update: unknown message type ${type}`);
  const count = view.getUint32(1, true);
  if (data.byteLength !== EVENTS_HEADER_BYTES + count * EVENT_BYTES) {
    throw new Error(`Live update: ${data.byteLength} bytes for ${count} events`);
  }
  const events: LiveEvent[] = [];
  for (let i = 0; i < count; i++) {
    const offset = EVENTS_HEADER_BYTES + i * EVENT_BYTES;
    events.push({
      id: view.getUint32(offset, true),
      position: view.getUint32(offset + 4, true),
      color_id: view.getUint8(offset + 8),
    });
  }
  return { type: 'events', events };
}
