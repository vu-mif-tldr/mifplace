import * as fs from 'node:fs';
import * as path from 'node:path';

// The repository root, two levels above this file both in src/ and in dist/.
// In Docker it is /app. Local settings (.env) live here, and relative paths in them
// are resolved against it, so every workspace and every cwd sees the same files.
export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

// Loads KEY=value pairs from an env file into process.env. Variables that are
// already set win, so Docker ENV, CI variables and the shell override the file.
// A missing file is not an error. Nothing goes to stdout: the MCP server uses it
// for the protocol and loads .env too.
export function loadDotEnv(file: string = path.join(REPO_ROOT, '.env')): void {
  if (fs.existsSync(file)) {
    process.loadEnvFile(file);
  } else {
    console.warn(`Env file not found: ${file}`);
  }
}

// Resolves a path setting against the repository root (an absolute one stays as is).
export function resolveFromRoot(value: string): string {
  return path.resolve(REPO_ROOT, value);
}
