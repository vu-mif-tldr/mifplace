<script setup lang="ts">
import type { LiveState } from '../live';
import { texts } from '../texts';
import BrandMark from './BrandMark.vue';
import LiveStatus from './LiveStatus.vue';

// The bar over the canvas: the logo and the name on the left; on the right how many pages are
// open, with a green light while the live connection is up, and the way out (FR-4). While the
// connection is not up, its state in words instead. The cell under the mouse (FR-11) is shown
// on the canvas.
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
    <span class="spacer"></span>
    <LiveStatus v-if="liveState && liveState !== 'connected'" :state="liveState" />
    <span v-if="online !== null" class="online">
      <span class="light"></span>
      <!-- A person, head and shoulders -->
      <svg viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="5" r="3" />
        <path d="M2 14.5c0-3.2 2.7-5.3 6-5.3s6 2.1 6 5.3z" />
      </svg>
      {{ online }}
    </span>
    <button v-if="email" type="button" class="sign-out" :title="email" @click="$emit('signOut')">
      {{ texts.signOut }}
    </button>
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 28px 12px;
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

/* Live, like the ticker */
.online {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgb(255 255 255 / 12%);
  font-family: var(--font-live);
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.online svg {
  width: 15px;
  height: 15px;
}

/* Connected: a green light that breathes */
.light {
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 50%;
  background: var(--ok);
  animation: pulse 2.2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgb(126 237 86 / 55%);
  }

  50% {
    box-shadow: 0 0 0 5px rgb(126 237 86 / 0%);
  }
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
    padding: 12px 16px 10px;
  }
}
</style>
