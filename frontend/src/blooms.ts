// A flash where a pixel has just arrived (MP-117). The page keeps a short list of them;
// each one is drawn by CSS and dropped once its animation is over.

// A bloom is made of up to two effects. Each one can be switched off with `enabled` and tuned
// with its own numbers; BloomLayer reads them, and a bloom lives as long as the longest one.
export type BloomEffects = {
  // A soft light: grows fast to `peakScale` of its size at full `opacity`, stays bright for a
  // moment, then grows to full size while it fades
  glow: {
    enabled: boolean;
    ms: number;
    // Size in cells, but never smaller than minPx, so it shows when the whole canvas is in view
    sizeCells: number;
    minPx: number;
    peakScale: number;
    opacity: number;
  };
  // Sharp rings that run out from the cell, with a thin contrast edge so they show on any colour
  ring: {
    enabled: boolean;
    ms: number;
    sizeCells: number;
    minPx: number;
    widthPx: number;
    edgePx: number;
    // How many rings, one after another, `gapMs` apart
    waves: number;
    gapMs: number;
  };
};

export const BLOOM_EFFECTS: BloomEffects = {
  glow: { enabled: true, ms: 2000, sizeCells: 9, minPx: 48, peakScale: 0.45, opacity: 0.9 },
  ring: {
    enabled: true,
    ms: 1100,
    sizeCells: 10,
    minPx: 64,
    widthPx: 3,
    edgePx: 1,
    waves: 1,
    gapMs: 300,
  },
};

// How long a bloom with these effects is shown, ms
export function bloomLifetime(effects: BloomEffects): number {
  const { glow, ring } = effects;
  return Math.max(
    glow.enabled ? glow.ms : 0,
    ring.enabled && ring.waves > 0 ? ring.ms + (ring.waves - 1) * ring.gapMs : 0
  );
}

// How long one bloom is shown, ms
export const BLOOM_MS = bloomLifetime(BLOOM_EFFECTS);

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
