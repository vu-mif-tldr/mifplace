<script setup lang="ts">
import { texts } from '../texts';

// What the page shows instead of the canvas while it loads, or when loading failed
defineProps<{ failed: boolean }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="load-state">
    <template v-if="failed">
      <span class="broken-ring"></span>
      <p class="title">{{ texts.loadFailed }}</p>
      <p class="hint">{{ texts.loadFailedHint }}</p>
      <button type="button" class="retry" @click="$emit('retry')">{{ texts.retry }}</button>
    </template>
    <template v-else>
      <span class="spinner"></span>
      <p>{{ texts.loading }}</p>
    </template>
  </div>
</template>

<style scoped>
.load-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  text-align: center;
}

p {
  margin: 0;
}

.title {
  font-size: 18px;
  font-weight: 600;
}

.hint {
  font-size: 14px;
  color: var(--muted);
}

.spinner {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: conic-gradient(#ffffff 0 28%, rgb(255 255 255 / 15%) 0);
  mask: radial-gradient(circle closest-side, transparent calc(100% - 6px), #000 calc(100% - 5px));
  animation: spin 1.1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.broken-ring {
  width: 64px;
  height: 64px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 5px dashed rgb(255 255 255 / 35%);
}

.retry {
  height: 48px;
  padding: 0 24px;
  border: 0;
  border-radius: 24px;
  background: #ffffff;
  color: var(--ink);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
</style>
