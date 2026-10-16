// Minimal logger: one line per message on stdout (debug, info) or stderr (warn, error).
//   2026-10-13T10:00:00.123Z INFO  [ws] client connected id=3 after=2924 clients=2
// The level comes from LOG_LEVEL (see .env.example); messages below it are dropped.

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Record<string, string | number | boolean | undefined>;

let threshold = LOG_LEVELS.indexOf('info');

export function setLogLevel(level: LogLevel): void {
  threshold = LOG_LEVELS.indexOf(level);
}

// Unset or empty means info; anything else must be one of LOG_LEVELS.
export function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw === '') return 'info';
  const level = raw.toLowerCase();
  if (!(LOG_LEVELS as readonly string[]).includes(level)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${raw}"`);
  }
  return level as LogLevel;
}

// Values with spaces or quotes are quoted, so a line stays easy to grep and to split.
function formatValue(value: string | number | boolean): string {
  const s = String(value);
  return /[\s"=]/.test(s) || s === '' ? JSON.stringify(s) : s;
}

export function formatLine(
  time: Date,
  level: LogLevel,
  scope: string,
  message: string,
  fields: LogFields = {}
): string {
  const parts = [time.toISOString(), level.toUpperCase().padEnd(5), `[${scope}]`, message];
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) parts.push(`${key}=${formatValue(value)}`);
  }
  return parts.join(' ');
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  // The error's stack goes on the following lines.
  error(message: string, fields?: LogFields, error?: unknown): void;
}

export function logger(scope: string): Logger {
  const write = (level: LogLevel, message: string, fields?: LogFields, error?: unknown) => {
    if (LOG_LEVELS.indexOf(level) < threshold) return;
    let line = formatLine(new Date(), level, scope, message, fields);
    if (error !== undefined) line += `\n${error instanceof Error ? error.stack : String(error)}`;
    if (level === 'warn' || level === 'error') console.error(line);
    else console.log(line);
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields, error) => write('error', message, fields, error),
  };
}
