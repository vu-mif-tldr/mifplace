// Development only: places random pixels through the HTTP API of a running backend, to watch the
// canvas page under load (blooms, lights from the top, the ticker).
//
// Usage: npm run dev:pixel-rain -w tools -- [per second] [seconds]
//   Defaults: 8 pixels a second for 30 s. Each pixel is a random cell in a random palette color.
// The backend is http://localhost:PORT, PORT from the environment, then from .env in the
// repository root. RATE_LIMIT_PIXELS_PER_MINUTE limits it: 8 a second is 480 a minute.
// It signs in as the development account (DEV_USER_EMAIL and DEV_USER_PASSWORD in .env, which
// the backend creates at start), like a browser would.
import { loadDotEnv } from '@mifplace/db';
import { CanvasSizeSchema, PaletteSchema } from '@mifplace/shared';

const [perSecond = 8, seconds = 30] = process.argv.slice(2).map(Number);
if (!(perSecond > 0) || !(seconds > 0)) {
  console.error('Usage: pixel-rain [per second] [seconds]');
  process.exit(1);
}

loadDotEnv();
const base = `http://localhost:${process.env.PORT ?? 3000}`;

// Signs in and returns the session cookie for the requests that follow
async function signIn(): Promise<string> {
  const email = process.env.DEV_USER_EMAIL;
  const password = process.env.DEV_USER_PASSWORD;
  if (!email || !password) {
    throw new Error('Set DEV_USER_EMAIL and DEV_USER_PASSWORD in .env (see .env.example)');
  }
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  if (!response.ok || !cookie) {
    throw new Error(`Could not sign in as ${email}: ${response.status}. Restart the backend?`);
  }
  return cookie;
}
const cookie = await signIn();

const getJson = async (path: string): Promise<unknown> => {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response.json();
};
const palette = PaletteSchema.parse(await getJson('/api/palette'));
const size = CanvasSizeSchema.parse(await getJson('/api/canvas/size'));
const random = (n: number) => Math.floor(Math.random() * n);

// Responses by status (201 placed, 429 over the rate limit...)
const statuses = new Map<number | string, number>();
const count = (key: number | string) => statuses.set(key, (statuses.get(key) ?? 0) + 1);

async function place() {
  try {
    const response = await fetch(`${base}/api/pixels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        pos: random(size.width * size.height),
        colorIndex: palette[random(palette.length)].id,
      }),
    });
    count(response.status);
  } catch {
    count('no answer');
  }
}

console.log(`${perSecond} pixels a second for ${seconds} s to ${base}`);
const requests: Promise<void>[] = [];
const timer = setInterval(() => requests.push(place()), 1000 / perSecond);
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
clearInterval(timer);
await Promise.all(requests);
console.log(Object.fromEntries(statuses));
