// How busy the canvas is right now, from the live stream this page has received: pixels per
// minute and, from them, how bright the light of the page is. Nothing here knows who placed a
// pixel (NFR-11).

// The window the numbers are counted over, ms
export const ACTIVITY_WINDOW_MS = 10_000;

// At this many pixels per minute the light is at its brightest
export const FULL_ENERGY_RATE = 600;

export type ActivityEvent = { at: number };

export type ActivitySummary = {
  // Pixels per minute over the window
  rate: number;
  // 0 (nothing happens) to 1 (FULL_ENERGY_RATE or more), for the light of the page
  energy: number;
};

// The events still inside the window at `now`
export function pruneActivity(events: ActivityEvent[], now: number): ActivityEvent[] {
  return events.filter((event) => now - event.at < ACTIVITY_WINDOW_MS);
}

// Grows quickly at first and slowly later, so a few people already light the page a little
export function energyOf(rate: number): number {
  return Math.min(1, Math.log1p(Math.max(0, rate)) / Math.log1p(FULL_ENERGY_RATE));
}

export function summarize(events: ActivityEvent[], now: number): ActivitySummary {
  const rate = Math.round((pruneActivity(events, now).length * 60_000) / ACTIVITY_WINDOW_MS);
  return { rate, energy: energyOf(rate) };
}
