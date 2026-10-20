<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getCanvas, placePixel } from './api';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  PIXEL_SIZE,
  drawCanvas,
  getClickedCell,
  paintCell,
} from './canvas';
import { PALETTE } from './palette';

// Currently selected color (black by default)
const selectedColor = ref(PALETTE[0]);

// The <canvas> element
const canvasEl = ref<HTMLCanvasElement | null>(null);

// Loading flag and error messages (empty string = no error)
const loading = ref(true);
const loadError = ref('');
const pixelError = ref('');

// Fetch the canvas from the server and draw it
async function loadCanvas() {
  loading.value = true;
  loadError.value = '';
  try {
    const state = await getCanvas();
    if (canvasEl.value) drawCanvas(canvasEl.value, state);
  } catch (error) {
    console.error(error);
    loadError.value = 'Nepavyko užkrauti drobės';
  } finally {
    loading.value = false;
  }
}

// Load the canvas when the page opens
onMounted(loadCanvas);

// Send the pixel to the server, draw it only if the server accepts it
async function onCanvasClick(event: MouseEvent) {
  if (!canvasEl.value) return;

  const { x, y } = getClickedCell(event);
  const color = selectedColor.value;

  try {
    await placePixel(x, y, PALETTE.indexOf(color));
    pixelError.value = '';
    paintCell(canvasEl.value, x, y, color);
  } catch (error) {
    console.error(error);
    pixelError.value = 'Pikselio padėti nepavyko';
  }
}
</script>

<template>
  <main>
    <section id="canvas-section">
      <h2>MIF PLACE</h2>

      <p v-if="loading">Kraunama…</p>
      <div v-else-if="loadError">
        <p class="error">{{ loadError }}</p>
        <button @click="loadCanvas">Bandyti dar kartą</button>
      </div>

      <canvas
        v-show="!loading && !loadError"
        id="canvas"
        ref="canvasEl"
        :width="CANVAS_WIDTH * PIXEL_SIZE"
        :height="CANVAS_HEIGHT * PIXEL_SIZE"
        @click="onCanvasClick"
      ></canvas>
      <p v-if="pixelError" class="error">{{ pixelError }}</p>
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
