<script setup lang="ts">
// The coordinates of a cell in a dark pill, next to the ring on it: the selected cell and the
// cell under the mouse. The parent places it.
defineProps<{ text: string }>();
</script>

<template>
  <span class="coords-label">{{ text }}</span>
</template>

<style scoped>
.coords-label {
  position: absolute;
  padding: 5px 11px;
  border-radius: 14px;
  background: var(--ink);
  color: #ffffff;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 12%);
}
</style>
