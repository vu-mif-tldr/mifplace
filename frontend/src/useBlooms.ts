import { ref } from 'vue';
import { BLOOM_MS, addBlooms, pruneBlooms, type Bloom, type NewBloom } from './blooms';

// The list of blooms for the page: add() after every live batch, and finished blooms are
// dropped by themselves
export function useBlooms(now: () => number = () => window.performance.now()) {
  const blooms = ref<Bloom[]>([]);

  function add(arrived: NewBloom[]) {
    blooms.value = addBlooms(blooms.value, arrived, now());
    // Drop the finished ones even if no more pixels arrive
    setTimeout(() => (blooms.value = pruneBlooms(blooms.value, now())), BLOOM_MS + 50);
  }

  return { blooms, add };
}
