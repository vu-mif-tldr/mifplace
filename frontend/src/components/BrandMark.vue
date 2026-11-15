<script setup lang="ts">
// The logo, the 3x3 pixels of the favicon (public/favicon.ico) in its colours, and the name.
// It keeps its colours whatever colour is selected.
withDefaults(defineProps<{ size?: number }>(), { size: 28 });

// The favicon's pixels row by row, without its dark background
const PIXELS = [
  ['#9184d9', '#5d5294', '#b5abfc'],
  ['#423a6a', '#d2cefd', '#5d5294'],
  ['#968ae0', '#423a6a', '#9184d9'],
].flatMap((row, y) => row.map((color, x) => ({ x: 2 + x * 10, y: 2 + y * 10, color })));
</script>

<template>
  <span class="brand">
    <svg :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true">
      <rect
        v-for="pixel in PIXELS"
        :key="`${pixel.x},${pixel.y}`"
        :x="pixel.x"
        :y="pixel.y"
        width="8"
        height="8"
        rx="1"
        :fill="pixel.color"
      />
    </svg>
    vu.place
  </span>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

@media (max-width: 720px) {
  .brand {
    font-size: 20px;
  }
}
</style>
