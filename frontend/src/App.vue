<script setup lang="ts">
import { ref } from 'vue';
import { paintPixel } from './canvas';
import { PALETTE } from './palette';

// Šiuo metu pasirinkta spalva (pradžioje juoda)
const selectedColor = ref(PALETTE[0]);

// Nuoroda į <canvas> elementą (ref="canvasEl" template'e)
const canvasEl = ref<HTMLCanvasElement | null>(null);

function onCanvasClick(event: MouseEvent) {
  if (!canvasEl.value) return;
  paintPixel(canvasEl.value, selectedColor.value, event);
}
</script>

<template>
  <main>
    <section id="canvas-section">
      <h2>MIF PLACE</h2>
      <canvas id="canvas" ref="canvasEl" width="800" height="600" @click="onCanvasClick"></canvas>
    </section>

    <section id="color-picker-section">
      <h2>Palette</h2>
      <div id="palette">
        <button
          v-for="color in PALETTE"
          :key="color"
          class="swatch"
          :class="{ selected: color === selectedColor }"
          :style="{ backgroundColor: color }"
          :title="color"
          @click="selectedColor = color"
        ></button>
      </div>
    </section>

    <section id="current-color-section">
      <h2>Selected color</h2>
      <div id="current-color-swatch" :style="{ backgroundColor: selectedColor }"></div>
      <span id="current-color-code">{{ selectedColor }}</span>
    </section>
  </main>
</template>
