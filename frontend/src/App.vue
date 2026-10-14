<script setup lang="ts">
import { ref } from 'vue';
import { PALETTE } from './palette';

// Šiuo metu pasirinkta spalva (pradžioje juoda)
const selectedColor = ref(PALETTE[0]);

// Vieno pikselio dydis: 800x600 canvas tampa 80x60 langelių
const PIXEL_SIZE = 10;

// Nuoroda į <canvas> elementą (ref="canvasEl" template'e)
const canvasEl = ref<HTMLCanvasElement | null>(null);

function paintPixel(event: MouseEvent) {
  const ctx = canvasEl.value?.getContext('2d');
  if (!ctx) return;

  // Kuriame langelyje paspausta (offsetX/offsetY - vieta canvas viduje)
  const column = Math.floor(event.offsetX / PIXEL_SIZE);
  const row = Math.floor(event.offsetY / PIXEL_SIZE);

  // Nudažom tą langelį pasirinkta spalva
  ctx.fillStyle = selectedColor.value;
  ctx.fillRect(column * PIXEL_SIZE, row * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
}
</script>

<template>
  <main>
    <section id="canvas-section">
      <h2>MIF PLACE</h2>
      <canvas id="canvas" ref="canvasEl" width="800" height="600" @click="paintPixel"></canvas>
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
