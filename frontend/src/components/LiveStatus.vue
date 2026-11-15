<script setup lang="ts">
import type { LiveState } from '../live';
import { texts } from '../texts';

// The state of the live connection to /api/ws: a dot and a word
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
  font-size: 14px;
  color: var(--muted);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--glow);
  box-shadow: 0 0 10px var(--glow);
}

.connecting .dot {
  background: #7f86ad;
  box-shadow: none;
}

.reconnecting {
  color: var(--warn);
}

.reconnecting .dot {
  background: var(--warn);
  box-shadow: none;
}
</style>
