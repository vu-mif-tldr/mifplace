<script setup lang="ts">
// The logo: a ring around one pixel, drawn in the current light (--glow), and the name
withDefaults(defineProps<{ size?: number }>(), { size: 28 });
</script>

<template>
  <span class="brand">
    <svg :width="size" :height="size" viewBox="0 0 30 30" aria-hidden="true">
      <circle cx="15" cy="15" r="12" fill="none" stroke="var(--glow)" stroke-width="3" />
      <rect x="12" y="12" width="6" height="6" fill="#ffffff" />
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
