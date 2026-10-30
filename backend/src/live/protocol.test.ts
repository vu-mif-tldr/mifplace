import { describe, expect, it } from 'vitest';
import { RESET, encodePixels, parseResumeRequest } from './protocol.js';

const parse = (query: string) => parseResumeRequest(new URLSearchParams(query));

describe('parseResumeRequest', () => {
  it('is live without a checkpoint', () => {
    expect(parse('')).toEqual({ kind: 'live' });
    expect(parse('other=1')).toEqual({ kind: 'live' });
  });

  it('resumes after a checkpoint of two valid numbers', () => {
    expect(parse('afterEventId=102&afterTimestamp=1760000000000')).toEqual({
      kind: 'resume',
      after: { eventId: 102, timestamp: 1760000000000 },
    });
  });

  it('resumes after 0/0, the checkpoint of an empty event log', () => {
    expect(parse('afterEventId=0&afterTimestamp=0')).toEqual({
      kind: 'resume',
      after: { eventId: 0, timestamp: 0 },
    });
  });

  it('is invalid with only one of the two parameters', () => {
    expect(parse('afterEventId=102')).toEqual({ kind: 'invalid' });
    expect(parse('afterTimestamp=1760000000000')).toEqual({ kind: 'invalid' });
  });

  const tooBig = String(Number.MAX_SAFE_INTEGER + 1);
  it.each(['', 'a', '-1', '1.5', '1e3', ' 1', '0x10', tooBig])(
    'is invalid for a value of "%s"',
    (value) => {
      const v = encodeURIComponent(value);
      expect(parse(`afterEventId=${v}&afterTimestamp=1`)).toEqual({ kind: 'invalid' });
      expect(parse(`afterEventId=1&afterTimestamp=${v}`)).toEqual({ kind: 'invalid' });
    }
  );

  it('accepts Number.MAX_SAFE_INTEGER', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(parse(`afterEventId=${max}&afterTimestamp=${max}`)).toEqual({
      kind: 'resume',
      after: { eventId: max, timestamp: max },
    });
  });
});

// The examples of docs/api.md, section 2
describe('encodePixels', () => {
  it('encodes a catch-up batch', () => {
    const message = encodePixels(
      [
        { eventId: 103, pos: 4, colorId: 12 },
        { eventId: 104, pos: 5, colorId: 5 },
      ],
      { eventId: 104, timestamp: 1760000000100 }
    );

    expect(JSON.parse(message)).toEqual({
      type: 'pixels',
      pixels: [
        [103, 4, 12],
        [104, 5, 5],
      ],
      eventId: 104,
      timestamp: 1760000000100,
    });
  });

  it('encodes a live update as compact JSON in the documented field order', () => {
    expect(
      encodePixels([{ eventId: 105, pos: 1, colorId: 5 }], {
        eventId: 105,
        timestamp: 1760000000200,
      })
    ).toBe('{"type":"pixels","pixels":[[105,1,5]],"eventId":105,"timestamp":1760000000200}');
  });
});

describe('RESET', () => {
  it('is the reset message', () => {
    expect(RESET).toBe('{"type":"reset"}');
  });
});
