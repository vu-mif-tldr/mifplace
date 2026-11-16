<script setup lang="ts">
import { TOP_LIGHT_KEYFRAMES, TOP_LIGHT_MS, type TopLight } from '../topLights';

// The lights from the top of the page in the colours of new pixels (topLights.ts). They lie
// behind everything else on the page, over its background.
defineProps<{ lights: TopLight[] }>();

// Each light plays the curve of topLights.ts from its age, so one that rises again (a new
// `start`, so a new element) goes on from the brightness it had. Played once per element.
const playing = new WeakSet<object>();
function play(el: unknown, light: TopLight) {
  if (!(el instanceof window.HTMLElement) || playing.has(el)) return;
  playing.add(el);
  el.animate?.(TOP_LIGHT_KEYFRAMES, {
    duration: TOP_LIGHT_MS,
    delay: light.start - window.performance.now(),
    fill: 'both',
  });
}
</script>

<template>
  <div class="top-lights">
    <span
      v-for="light in lights"
      :key="`${light.id}:${light.start}`"
      :ref="(el) => play(el, light)"
      class="light"
      :style="{ '--light': light.color }"
    ></span>
  </div>
</template>

<style scoped>
.top-lights {
  position: absolute;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}

/* Its brightness (opacity) is played from script */
.light {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    60% 50% at 50% 0%,
    color-mix(in srgb, var(--light) 40%, transparent),
    transparent
  );
  opacity: 0;
}
</style>
