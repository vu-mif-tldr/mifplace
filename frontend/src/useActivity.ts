import { onScopeDispose, ref } from 'vue';
import { pruneActivity, summarize, type ActivityEvent, type ActivitySummary } from './activity';
import { MAX_BATCH_FOR_BLOOMS, type NewBloom } from './blooms';

// How often the numbers are counted again when no pixels arrive, ms
export const ACTIVITY_REFRESH_MS = 2000;

// How busy the page is: record() every live batch; the summary is counted again on every batch
// and every ACTIVITY_REFRESH_MS, so it also falls back to quiet when nothing arrives.
export function useActivity(now: () => number = () => Date.now()) {
  let events: ActivityEvent[] = [];
  const summary = ref<ActivitySummary>(summarize([], now()));

  function refresh() {
    events = pruneActivity(events, now());
    summary.value = summarize(events, now());
  }

  // A catch-up batch after a reconnect holds pixels from the past: they are not "now"
  function record(pixels: NewBloom[]) {
    if (pixels.length === 0 || pixels.length > MAX_BATCH_FOR_BLOOMS) return;
    const time = now();
    events.push(...pixels.map(() => ({ at: time })));
    refresh();
  }

  const timer = setInterval(refresh, ACTIVITY_REFRESH_MS);
  onScopeDispose(() => clearInterval(timer));

  return { summary, record };
}
