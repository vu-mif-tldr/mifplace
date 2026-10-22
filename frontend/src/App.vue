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

const scale = ref(1);
const x = ref(0);
const y = ref(0);

function onWheel(event: WheelEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  const zoom = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newScale = Math.min(20, Math.max(0.5, scale.value * zoom));
  const ratio = newScale / scale.value;

  x.value = mouseX - (mouseX - x.value) * ratio;
  y.value = mouseY - (mouseY - y.value) * ratio;
  scale.value = newScale;
}

let dragging = false;
let moved = false;
let lastX = 0;
let lastY = 0;
let startX = 0;
let startY = 0;

function onMouseDown(event: MouseEvent) {
  dragging = true;
  moved = false;
  startX = lastX = event.clientX;
  startY = lastY = event.clientY;
}

function onMouseMove(event: MouseEvent) {
  if (!dragging) return;

  if (Math.hypot(event.clientX - startX, event.clientY - startY) > 4) moved = true;
  if (!moved) return;

  x.value += event.clientX - lastX;
  y.value += event.clientY - lastY;
  lastX = event.clientX;
  lastY = event.clientY;
}

// Send the pixel to the server, draw it only if the server accepts it.
// Ignored at the end of a drag, so moving the canvas does not place a pixel.
async function onCanvasClick(event: MouseEvent) {
  if (moved || !canvasEl.value) return;

  const cell = getClickedCell(event);
  const color = selectedColor.value;

  try {
    await placePixel(cell.x, cell.y, PALETTE.indexOf(color));
    pixelError.value = '';
    paintCell(canvasEl.value, cell.x, cell.y, color);
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

      <div
        v-show="!loading && !loadError"
        id="viewport"
        @wheel.prevent="onWheel"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="dragging = false"
        @mouseleave="dragging = false"
      >
        <canvas
          id="canvas"
          ref="canvasEl"
          :width="CANVAS_WIDTH * PIXEL_SIZE"
          :height="CANVAS_HEIGHT * PIXEL_SIZE"
          :style="{ transform: `translate(${x}px, ${y}px) scale(${scale})` }"
          @click="onCanvasClick"
        ></canvas>
      </div>
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
