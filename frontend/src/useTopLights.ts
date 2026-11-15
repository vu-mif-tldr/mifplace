import { ref } from 'vue';
import { TOP_LIGHT_MS, addTopLights, pruneTopLights, type TopLight } from './topLights';

// The lights from the top for the page: add() after every live batch, and finished lights are
// dropped by themselves. With reduced motion the list stays empty.
export function useTopLights(
  reducedMotion: { matches: boolean } = window.matchMedia('(prefers-reduced-motion: reduce)'),
  now: () => number = () => window.performance.now()
) {
  const lights = ref<TopLight[]>([]);

  function add(colors: string[]) {
    if (reducedMotion.matches) return;
    const before = lights.value;
    lights.value = addTopLights(before, colors, now());
    // A light that started or rose again shines longer: drop it once it is out, even if no more
    // pixels arrive
    if (lights.value.some((light) => !before.includes(light))) {
      setTimeout(() => (lights.value = pruneTopLights(lights.value, now())), TOP_LIGHT_MS + 50);
    }
  }

  return { lights, add };
}
