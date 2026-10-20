// Log level names, the same on the server (LOG_LEVEL) and in the browser console.
// The loggers themselves differ and live next to their users.
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
