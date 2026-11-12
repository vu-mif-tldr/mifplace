import { encodePixels, type Checkpoint, type PixelEvent } from './protocol.js';

// What a client that connects with a checkpoint gets first (docs/api.md, "Connecting and
// resuming"): the events it missed, a reset when they cannot be sent, or nothing. A pure
// decision: the event log and the broadcaster come in through deps, so every rule has a test.

export type CatchUpResult =
  | { kind: 'events'; message: string } // an encoded pixels message with the missed events
  | { kind: 'reset' } // the checkpoint cannot be resumed
  | { kind: 'none' }; // nothing missed, the next batches are enough

export interface CatchUpDeps {
  // The last event the broadcaster has sent; events after it come with the next batch
  lastSent: Checkpoint;
  // The timestamp of a stored event, undefined when there is no event with that id
  timestampOf(eventId: number): number | undefined;
  // The stored events with ids in (afterId, toId], in order
  eventsBetween(afterId: number, toId: number): PixelEvent[];
  // How far behind a checkpoint may be; further back the client reloads the snapshot instead
  maxBacklog: number;
}

export function catchUp(after: Checkpoint, deps: CatchUpDeps): CatchUpResult {
  // 0/0 is the checkpoint of an empty log: valid, nothing to look up
  const emptyLog = after.eventId === 0 && after.timestamp === 0;
  // An unknown id, or a known id with another time: a database restored from a backup can
  // give an old id to a new event (ADR-0003, R2), so the client's canvas cannot be trusted
  if (!emptyLog && deps.timestampOf(after.eventId) !== after.timestamp) return { kind: 'reset' };
  // Nothing was sent after this checkpoint. Events stored but not yet sent come with the
  // next batch, and the client skips the ids it already has
  if (after.eventId >= deps.lastSent.eventId) return { kind: 'none' };
  // Too far behind: the snapshot is cheaper than the backlog
  if (deps.lastSent.eventId - after.eventId > deps.maxBacklog) return { kind: 'reset' };
  return {
    kind: 'events',
    message: encodePixels(deps.eventsBetween(after.eventId, deps.lastSent.eventId), deps.lastSent),
  };
}
