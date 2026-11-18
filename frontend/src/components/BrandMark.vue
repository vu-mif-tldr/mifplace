<script setup lang="ts">
// The logo of the university and the name of the site, set apart by space alone (the logo has
// a line of its own). White on the bordo page, whatever colour is selected. The logo is large
// enough to read its words.
withDefaults(defineProps<{ size?: number }>(), { size: 78 });
</script>

<template>
  <span class="brand" :style="{ '--logo': `${size}px` }">
    <img class="logo" src="/vu-logo.png" alt="Vilniaus universitetas" />
    <span class="name">VU/place</span>
  </span>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 30px;
}

.logo {
  display: block;
  width: auto;
  height: var(--logo);
}

.name {
  font-family: var(--font-display);
  font-size: 38px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
}

@media (max-width: 720px) {
  .brand {
    gap: 18px;
  }

  .logo {
    height: calc(var(--logo) * 0.65);
  }

  .name {
    font-size: 26px;
  }
}
</style>
