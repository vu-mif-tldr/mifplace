// A positive integer setting from the environment. Unset or empty gives the fallback; anything
// else that is not a positive integer stops the server at start, like an invalid PORT: a typo
// must not silently turn a limit off.
export function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  // Digits only: "1e3", "1.5" and " 1" are mistakes, not settings
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return Number(raw);
}

// An on/off setting from the environment: "true" or "false". Unset or empty gives the
// fallback; anything else stops the server at start, for the same reason.
export function onOff(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw !== 'true' && raw !== 'false') throw new Error(`Invalid ${name}: ${raw}`);
  return raw === 'true';
}
