<script setup lang="ts">
import type { Color } from '../api';

// The palette, always visible: the chosen colour is the one the canvas draws with.
defineProps<{ palette: Color[] }>();
const chosen = defineModel<Color>({ required: true });
</script>

<template>
  <div id="palette" role="group" aria-label="Palette">
    <button
      v-for="color in palette"
      :key="color.id"
      type="button"
      class="swatch"
      :style="{ backgroundColor: color.rgb }"
      :title="color.rgb"
      :aria-label="color.rgb"
      :aria-pressed="chosen.id === color.id"
      @click="chosen = color"
    />
  </div>
</template>
