import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger, setLogLevel } from './log';

describe('logger', () => {
  afterEach(() => {
    setLogLevel('info');
    vi.restoreAllMocks();
  });

  it('drops messages below the level and passes fields and errors as separate arguments', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setLogLevel('info');
    const log = logger('ws');

    log.debug('hidden');
    log.info('connected', { after: 5 });
    log.info('no fields', {});
    const error = new Error('boom');
    log.warn('failed', { position: 1 }, error);

    expect(debug).not.toHaveBeenCalled();
    expect(info.mock.calls).toEqual([['[ws] connected', { after: 5 }], ['[ws] no fields']]);
    expect(warn).toHaveBeenCalledWith('[ws] failed', { position: 1 }, error);

    setLogLevel('debug');
    log.debug('shown');
    expect(debug).toHaveBeenCalledWith('[ws] shown');
  });
});
