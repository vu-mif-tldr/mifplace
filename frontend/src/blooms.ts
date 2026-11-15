// A soft flash where a pixel has just arrived (MP-117). The page keeps a short list of them;
// each one is drawn by CSS and dropped once its animation is over.

// How long one bloom is shown, ms (the CSS animation uses the same time)
export const BLOOM_MS = 1400;

// At most this many on the page at once: the oldest go first
export const MAX_BLOOMS = 60;

// A bigger batch is a catch-up after a reconnect (up to thousands of pixels from the past):
// it is painted without blooms
export const MAX_BATCH_FOR_BLOOMS = 40;

export type Bloom = { id: number; x: number; y: number; color: string; born: number };

export type NewBloom = Omit<Bloom, 'id' | 'born'>;

let lastId = 0;

// The blooms still running at `now`
export function pruneBlooms(blooms: Bloom[], now: number): Bloom[] {
  return blooms.filter((bloom) => now - bloom.born < BLOOM_MS);
}

// The list after one batch of pixels arrived at `now`
export function addBlooms(blooms: Bloom[], incoming: NewBloom[], now: number): Bloom[] {
  const alive = pruneBlooms(blooms, now);
  if (incoming.length === 0 || incoming.length > MAX_BATCH_FOR_BLOOMS) return alive;
  const added = incoming.map((bloom) => ({ ...bloom, id: ++lastId, born: now }));
  return alive.concat(added).slice(-MAX_BLOOMS);
}
