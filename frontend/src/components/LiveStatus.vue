<script setup lang="ts">
import type { LiveState } from '../live';
import { texts } from '../texts';

// The state of the live connection to /api/ws (other people's pixels come through it):
// green while connected, yellow while connecting, pink after a drop until it is back
defineProps<{ state: LiveState }>();

const LABELS: Record<LiveState, string> = {
  connected: texts.live,
  connecting: texts.connecting,
  reconnecting: texts.reconnecting,
};
</script>

<template>
  <span class="live-status" :class="state">
    <span class="dot"></span>
    <span class="label">{{ LABELS[state] }}</span>
  </span>
</template>

<style scoped>
.live-status {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgb(255 255 255 / 12%);
  font-family: var(--font-live);
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  /* May get narrower than its text (a narrow top bar); the text is then cut short */
  min-width: 0;
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ok);
}

/* Breathes while connected */
.connected .dot {
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

.connecting .dot {
  background: var(--warn);
}

.reconnecting {
  color: var(--error);
}

.reconnecting .dot {
  background: var(--error);
}
</style>
