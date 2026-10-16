import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { formatLine, logger, parseLogLevel, setLogLevel } from './log.js';

describe('formatLine', () => {
  it('writes time, level, scope, message and the defined fields', () => {
    const line = formatLine(new Date('2026-10-13T10:00:00.123Z'), 'info', 'ws', 'connected', {
      id: 3,
      after: 2924,
      skipped: undefined,
      ok: true,
    });
    assert.equal(line, '2026-10-13T10:00:00.123Z INFO  [ws] connected id=3 after=2924 ok=true');
  });

  it('quotes values with spaces, quotes or equal signs, and empty values', () => {
    const line = formatLine(new Date(0), 'warn', 'http', 'bad', {
      reason: 'Body is too large',
      raw: 'a=b',
      empty: '',
    });
    assert.match(line, / reason="Body is too large" raw="a=b" empty=""$/);
  });
});

describe('parseLogLevel', () => {
  it('defaults to info, accepts any case, rejects unknown levels', () => {
    assert.equal(parseLogLevel(undefined), 'info');
    assert.equal(parseLogLevel(''), 'info');
    assert.equal(parseLogLevel('DEBUG'), 'debug');
    assert.throws(() => parseLogLevel('verbose'), /LOG_LEVEL must be one of debug, info/);
  });
});

describe('logger', () => {
  afterEach(() => {
    setLogLevel('info');
    mock.restoreAll();
  });

  it('drops messages below the level, warn and error go to stderr', () => {
    const out = mock.method(console, 'log', () => {});
    const err = mock.method(console, 'error', () => {});
    setLogLevel('info');
    const log = logger('test');
    log.debug('hidden');
    log.info('shown');
    log.error('failed', { id: 1 }, new Error('boom'));
    assert.equal(out.mock.callCount(), 1);
    assert.match(String(out.mock.calls[0].arguments[0]), /INFO {2}\[test\] shown$/);
    assert.equal(err.mock.callCount(), 1);
    assert.match(String(err.mock.calls[0].arguments[0]), /ERROR \[test\] failed id=1\nError: boom/);

    setLogLevel('debug');
    log.debug('now shown');
    assert.equal(out.mock.callCount(), 2);
  });
});
