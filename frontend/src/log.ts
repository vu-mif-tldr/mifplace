// Minimal logger for the browser console: "[ws] connected" plus the fields as an object, which
// DevTools shows expandable. The level is read once from localStorage, for example:
//   localStorage['mifplace.log'] = 'debug'   then reload the page
// debug adds a line per saved pixel and per received batch.

import { LOG_LEVELS, type LogLevel } from '@mifplace/shared';

export { LOG_LEVELS, type LogLevel };
export type LogFields = Record<string, unknown>;

const STORAGE_KEY = 'mifplace.log';

function storedLevel(): LogLevel {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (value && (LOG_LEVELS as readonly string[]).includes(value)) return value as LogLevel;
  } catch {
    // Storage may be blocked (private mode, site settings), the default is fine.
  }
  return 'info';
}

let threshold = LOG_LEVELS.indexOf(storedLevel());

export function setLogLevel(level: LogLevel): void {
  threshold = LOG_LEVELS.indexOf(level);
}

export function getLogLevel(): LogLevel {
  return LOG_LEVELS[threshold];
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields, error?: unknown): void;
  error(message: string, fields?: LogFields, error?: unknown): void;
}

export function logger(scope: string): Logger {
  const write = (level: LogLevel, message: string, fields?: LogFields, error?: unknown) => {
    if (LOG_LEVELS.indexOf(level) < threshold) return;
    const args: unknown[] = [`[${scope}] ${message}`];
    if (fields && Object.keys(fields).length > 0) args.push(fields);
    if (error !== undefined) args.push(error);
    console[level](...args);
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields, error) => write('warn', message, fields, error),
    error: (message, fields, error) => write('error', message, fields, error),
  };
}
