<script setup lang="ts">
import type { LiveState } from '../live';
import { texts } from '../texts';
import type { Cell } from '../view';
import BrandMark from './BrandMark.vue';
import LiveStatus from './LiveStatus.vue';

// The bar over the canvas: the logo, the cell under the mouse (FR-11), how many pages are open
// and the connection
defineProps<{
  hoveredCell: Cell | null;
  // null while there is no connection yet (loading, or loading failed)
  liveState: LiveState | null;
  // null while not connected: an old count would be wrong
  online: number | null;
}>();
</script>

<template>
  <header class="top-bar">
    <BrandMark />
    <span class="spacer"></span>
    <span v-if="hoveredCell" class="coords">
      {{ texts.coordinates(hoveredCell.x, hoveredCell.y) }}
    </span>
    <span v-if="online !== null" class="online">
      <!-- A person, head and shoulders -->
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <circle cx="8" cy="5" r="3" />
        <path d="M2 14.5c0-3.2 2.7-5.3 6-5.3s6 2.1 6 5.3z" />
      </svg>
      {{ online }}
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

.coords,
.online {
  font-size: 14px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

/* Live, like the ticker and the connection next to it */
.online {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-live);
  font-weight: 500;
}

.online svg {
  width: 15px;
  height: 15px;
}

@media (max-width: 720px) {
  .top-bar {
    padding: 14px 16px;
  }
}
</style>
