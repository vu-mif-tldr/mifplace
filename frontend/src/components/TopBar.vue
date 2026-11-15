<script setup lang="ts">
import type { LiveState } from '../live';
import { texts } from '../texts';
import type { Cell } from '../view';
import BrandMark from './BrandMark.vue';
import LiveStatus from './LiveStatus.vue';

// The bar over the canvas: the logo, the cell under the mouse (FR-11) and the connection
defineProps<{
  hoveredCell: Cell | null;
  // null while there is no connection yet (loading, or loading failed)
  liveState: LiveState | null;
}>();
</script>

<template>
  <header class="top-bar">
    <BrandMark />
    <span class="spacer"></span>
    <span v-if="hoveredCell" class="coords">
      {{ texts.coordinates(hoveredCell.x, hoveredCell.y) }}
    </span>
    <LiveStatus v-if="liveState" :state="liveState" />
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 28px;
}

.spacer {
  flex-grow: 1;
}

.coords {
  font-size: 14px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 720px) {
  .top-bar {
    padding: 14px 16px;
  }
}
</style>
