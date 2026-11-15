// A light from the top of the page in the colour of a pixel that has just arrived, as the
// selected colour lights the page from the bottom. Each light rises to its peak, holds it for
// a moment and fades out. At most MAX_TOP_LIGHTS shine at once, so the page never flickers.
//
// The same colour again (the light colour, so all dark pixels count as one) never takes a new
// light: while its light rises or holds the peak, it is ignored; while the light fades, the
// light rises again from where it is, at the usual speed, to the same peak.

import { MAX_BATCH_FOR_BLOOMS } from './blooms';

// Up to the peak, on the peak, down to nothing, ms
export const RISE_MS = 180;
export const HOLD_MS = 100;
export const FALL_MS = 1020;
export const TOP_LIGHT_MS = RISE_MS + HOLD_MS + FALL_MS;

// At most this many at once; any more are skipped, the running ones are never cut short
export const MAX_TOP_LIGHTS = 3;

// How bright a light is (0 to 1) by its age, in straight pieces between these points: quick
// up, a short hold, then down fast at first and slowly at the end
const CURVE: { at: number; level: number }[] = [
  { at: 0, level: 0 },
  { at: RISE_MS, level: 1 },
  { at: RISE_MS + HOLD_MS, level: 1 },
  { at: RISE_MS + HOLD_MS + FALL_MS * 0.2, level: 0.5 },
  { at: RISE_MS + HOLD_MS + FALL_MS * 0.45, level: 0.2 },
  { at: TOP_LIGHT_MS, level: 0 },
];

// `start` is when the light would have started from nothing to be where it is now: a light
// that rises again is moved later, so its age is again on the way up
export type TopLight = { id: number; color: string; start: number };

let lastId = 0;

// Brightness of a light `age` ms old
export function levelAt(age: number): number {
  if (age <= 0 || age >= TOP_LIGHT_MS) return 0;
  const next = CURVE.findIndex((point) => point.at > age);
  const a = CURVE[next - 1];
  const b = CURVE[next];
  return a.level + ((b.level - a.level) * (age - a.at)) / (b.at - a.at);
}

// The curve as Web Animations keyframes, for the light on the page
export const TOP_LIGHT_KEYFRAMES: Keyframe[] = CURVE.map(({ at, level }) => ({
  offset: at / TOP_LIGHT_MS,
  opacity: level,
}));

// The lights still shining at `now`
export function pruneTopLights(lights: TopLight[], now: number): TopLight[] {
  return lights.filter((light) => now - light.start < TOP_LIGHT_MS);
}

// The list after one batch of pixels in these light colours arrived at `now`. A catch-up batch
// after a reconnect is from the past and lights nothing.
export function addTopLights(lights: TopLight[], colors: string[], now: number): TopLight[] {
  const result = pruneTopLights(lights, now);
  if (colors.length > MAX_BATCH_FOR_BLOOMS) return result;
  for (const color of colors) {
    const index = result.findIndex((light) => light.color === color);
    if (index >= 0) {
      const age = now - result[index].start;
      // Rising or on the peak: nothing to add. Fading: up again from the same brightness.
      if (age > RISE_MS + HOLD_MS) {
        result[index] = { ...result[index], start: now - levelAt(age) * RISE_MS };
      }
    } else if (result.length < MAX_TOP_LIGHTS) {
      result.push({ id: ++lastId, color, start: now });
    }
  }
  return result;
}
