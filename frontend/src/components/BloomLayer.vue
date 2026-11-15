<script setup lang="ts">
import { computed } from 'vue';
import type { Bloom } from '../blooms';
import { cellCenter, type Cell } from '../view';

// The flashes where pixels have just arrived (MP-117), over the canvas in viewport px.
// Each one is a CSS animation; the list itself is kept by useBlooms.
const props = defineProps<{ blooms: Bloom[]; offset: Cell; cellPx: number }>();

const views = computed(() => {
  const size = Math.max(48, props.cellPx * 9);
  return props.blooms.map((bloom) => ({
    id: bloom.id,
    color: bloom.color,
    size,
    ...cellCenter(bloom, props.offset, props.cellPx),
  }));
});
</script>

<template>
  <span
    v-for="bloom in views"
    :key="bloom.id"
    class="bloom"
    :style="{
      left: `${bloom.x}px`,
      top: `${bloom.y}px`,
      width: `${bloom.size}px`,
      height: `${bloom.size}px`,
      '--bloom': bloom.color,
    }"
  ></span>
</template>

<style scoped>
.bloom {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--bloom) 85%, transparent),
    transparent 70%
  );
  animation: bloom 1.4s ease-out forwards;
}

@keyframes bloom {
  from {
    transform: translate(-50%, -50%) scale(0.15);
    opacity: 0.8;
  }
  to {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0;
  }
}
</style>
