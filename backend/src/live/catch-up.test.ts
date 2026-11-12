import { describe, expect, it, vi } from 'vitest';
import { catchUp, type CatchUpDeps } from './catch-up.js';

// A log of events 1..5, timestamp = id * 1000, of which 1..4 were sent
const log = [1, 2, 3, 4, 5].map((id) => ({
  eventId: id,
  pos: id * 10,
  colorId: id,
  timestamp: id * 1000,
}));

function deps(overrides: Partial<CatchUpDeps> = {}): CatchUpDeps {
  return {
    lastSent: { eventId: 4, timestamp: 4000 },
    timestampOf: (id) => log.find((e) => e.eventId === id)?.timestamp,
    eventsBetween: vi.fn((afterId, toId) =>
      log.filter((e) => e.eventId > afterId && e.eventId <= toId)
    ),
    maxBacklog: 10,
    ...overrides,
  };
}

describe('catchUp', () => {
  it('sends the events after the checkpoint up to the last sent one, with that checkpoint', () => {
    const d = deps();
    const result = catchUp({ eventId: 2, timestamp: 2000 }, d);

    expect(result.kind).toBe('events');
    expect(JSON.parse((result as { message: string }).message)).toEqual({
      type: 'pixels',
      pixels: [
        [3, 30, 3],
        [4, 40, 4],
      ],
      eventId: 4,
      timestamp: 4000,
    });
    expect(d.eventsBetween).toHaveBeenCalledWith(2, 4);
  });

  it('treats 0/0, the checkpoint of an empty log, as valid', () => {
    expect(catchUp({ eventId: 0, timestamp: 0 }, deps()).kind).toBe('events');
    // Nothing sent yet either: nothing to catch up
    expect(
      catchUp({ eventId: 0, timestamp: 0 }, deps({ lastSent: { eventId: 0, timestamp: 0 } }))
    ).toEqual({
      kind: 'none',
    });
  });

  it('resets an unknown id', () => {
    expect(catchUp({ eventId: 9, timestamp: 9000 }, deps())).toEqual({ kind: 'reset' });
  });

  it('resets a known id with another timestamp (a restored database)', () => {
    expect(catchUp({ eventId: 2, timestamp: 2001 }, deps())).toEqual({ kind: 'reset' });
    expect(catchUp({ eventId: 2, timestamp: 0 }, deps())).toEqual({ kind: 'reset' });
  });

  it('sends nothing when the checkpoint is the last sent event or a stored but unsent one', () => {
    expect(catchUp({ eventId: 4, timestamp: 4000 }, deps())).toEqual({ kind: 'none' });
    // Event 5 is in the log and still pending in the broadcaster: the next batch brings it
    expect(catchUp({ eventId: 5, timestamp: 5000 }, deps())).toEqual({ kind: 'none' });
  });

  it('resets a checkpoint further behind than maxBacklog', () => {
    expect(catchUp({ eventId: 1, timestamp: 1000 }, deps({ maxBacklog: 2 })).kind).toBe('reset');
    // Exactly maxBacklog behind is still a catch-up
    expect(catchUp({ eventId: 1, timestamp: 1000 }, deps({ maxBacklog: 3 })).kind).toBe('events');
  });

  it('checks the timestamp before anything else', () => {
    const d = deps({ lastSent: { eventId: 2, timestamp: 2000 } });
    expect(catchUp({ eventId: 3, timestamp: 1 }, d)).toEqual({ kind: 'reset' });
    expect(d.eventsBetween).not.toHaveBeenCalled();
  });
});
