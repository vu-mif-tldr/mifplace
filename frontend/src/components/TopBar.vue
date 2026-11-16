<script setup lang="ts">
import type { LiveState } from '../live';
import BrandMark from './BrandMark.vue';
import LiveStatus from './LiveStatus.vue';

// The bar over the canvas: the logo with the commit of the build, how many pages are open and the
// connection. The cell under the mouse (FR-11) is shown on the canvas, next to it.
const appCommit = import.meta.env.APP_COMMIT;

defineProps<{
  // null while there is no connection yet (loading, or loading failed)
  liveState: LiveState | null;
  // null while not connected: an old count would be wrong
  online: number | null;
}>();
</script>

<template>
  <header class="top-bar">
    <BrandMark />
    <!-- docs/development.md, "Versions" -->
    <span class="version">{{ appCommit }}</span>
    <span class="spacer"></span>
    <span v-if="online !== null" class="online">
      <!-- A person, head and shoulders -->
      <svg viewBox="0 0 16 16" fill="currentColor">
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

/* Quiet: for whoever looks for it, closer to the name than the gap of the bar */
.version {
  margin-left: -8px;
  padding-top: 3px;
  font-size: 12px;
  color: var(--muted);
  opacity: 0.55;
  font-variant-numeric: tabular-nums;
}

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
