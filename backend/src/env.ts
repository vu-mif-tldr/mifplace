import * as fs from 'node:fs';
import { logger } from './log.js';

const log = logger('env');

// Loads KEY=value pairs from an env file into process.env. Variables that are
// already set win, so Docker ENV, CI variables and the shell override the file.
// A missing file is not an error. A relative path is resolved against the cwd.
export function loadDotEnv(file: string): void {
  if (fs.existsSync(file)) {
    log.info('loading env file', { file });
    process.loadEnvFile(file);
  } else {
    log.warn('env file not found', { file });
  }
}

// Reads an integer setting. Unset or empty means the default; anything else must be
// decimal digits within [min, max], otherwise the server refuses to start. Number() alone
// is not enough: it turns an empty value into 0 and accepts "1e3" or " 5".
export function envInt(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}, got "${raw}"`);
  }
  return value;
}
