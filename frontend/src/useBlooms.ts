import { ref } from 'vue';
import { BLOOM_MS, addBlooms, pruneBlooms, type Bloom, type NewBloom } from './blooms';

// The list of blooms for the page: add() after every live batch, and finished blooms are
// dropped by themselves. With reduced motion the list stays empty.
export function useBlooms(
  reducedMotion: { matches: boolean } = window.matchMedia('(prefers-reduced-motion: reduce)'),
  now: () => number = () => window.performance.now()
) {
  const blooms = ref<Bloom[]>([]);

  function add(arrived: NewBloom[]) {
    if (reducedMotion.matches) return;
    blooms.value = addBlooms(blooms.value, arrived, now());
    // Drop the finished ones even if no more pixels arrive
    setTimeout(() => (blooms.value = pruneBlooms(blooms.value, now())), BLOOM_MS + 50);
  }

  return { blooms, add };
}
