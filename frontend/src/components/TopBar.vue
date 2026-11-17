<script setup lang="ts">
import type { LiveState } from '../live';
import { texts } from '../texts';
import BrandMark from './BrandMark.vue';
import LiveStatus from './LiveStatus.vue';

// The bar over the canvas: the logo with the commit of the build, how many pages are open, the
// connection and the way out (FR-4). The cell under the mouse (FR-11) is shown on the canvas,
// next to it.
const appCommit = import.meta.env.APP_COMMIT;

defineProps<{
  // null while there is no connection yet (loading, or loading failed)
  liveState: LiveState | null;
  // null while not connected: an old count would be wrong
  online: number | null;
  // The address of the signed-in user; without it there is nobody to sign out
  email?: string | null;
}>();
defineEmits<{ signOut: [] }>();
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
    <button v-if="email" type="button" class="sign-out" :title="email" @click="$emit('signOut')">
      {{ texts.signOut }}
    </button>
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 28px;
  /* As a grid item of the page it must not grow wider than the page to fit its content */
  min-width: 0;
}

/* Nothing in the bar is squeezed or wraps: on a phone the long "reconnecting" text is cut
   short instead (LiveStatus), so the way out stays in view. */
.top-bar > * {
  flex: none;
}

.top-bar > .live-status {
  flex: 0 1 auto;
}

.top-bar > .spacer {
  flex: 1 1 0;
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

/* Quiet: it is rarely needed */
.sign-out {
  padding: 6px 0;
  border: 0;
  background: none;
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
}

.sign-out:hover {
  color: var(--text);
}

@media (max-width: 720px) {
  .top-bar {
    gap: 12px;
    padding: 14px 16px;
  }

  /* No room for it next to the way out */
  .version {
    display: none;
  }
}
</style>
