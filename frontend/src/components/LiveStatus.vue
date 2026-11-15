<script setup lang="ts">
import type { LiveState } from '../live';
import { texts } from '../texts';

// The state of the live connection to /api/ws (other people's pixels come through it):
// green while connected, yellow while connecting, red after a drop until it is back
defineProps<{ state: LiveState }>();

const LABELS: Record<LiveState, string> = {
  connected: texts.live,
  connecting: texts.connecting,
  reconnecting: texts.reconnecting,
};
</script>

<template>
  <span class="live-status" :class="state" role="status">
    <span class="dot"></span>{{ LABELS[state] }}
  </span>
</template>

<style scoped>
.live-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-live);
  font-size: 14px;
  font-weight: 500;
  color: var(--muted);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 8px var(--ok);
}

.connecting .dot {
  background: var(--warn);
  box-shadow: none;
}

.reconnecting {
  color: var(--error);
}

.reconnecting .dot {
  background: var(--error);
  box-shadow: none;
}
</style>
