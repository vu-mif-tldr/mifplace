import { parseArgs } from 'node:util';
import { TRANSPORTS } from '../shared/protocol.ts';
import { DEFAULT_OPTIONS, startApp, type AppOptions } from './app.ts';

// Every AppOptions field is a flag: batchMs -> --batch-ms, botRate -> --bot-rate, and so on.
const toFlag = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const { values } = parseArgs({
  options: Object.fromEntries(
    Object.keys(DEFAULT_OPTIONS).map((key) => [toFlag(key), { type: 'string' as const }])
  ),
});

const options: Record<string, string | number> = {};
for (const [key, fallback] of Object.entries(DEFAULT_OPTIONS)) {
  const value = values[toFlag(key)];
  if (typeof value !== 'string') continue;
  if (typeof fallback === 'number' && !Number.isFinite(Number(value))) {
    throw new Error(`--${toFlag(key)} must be a number, got "${value}"`);
  }
  options[key] = typeof fallback === 'number' ? Number(value) : value;
}

const app = await startApp(options as Partial<AppOptions>);
console.log(`Prototype server on ${app.url}`);
for (const transport of TRANSPORTS)
  console.log(`  ${transport.padEnd(5)} ${app.url}/?t=${transport}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().then(() => process.exit(0)));
}
