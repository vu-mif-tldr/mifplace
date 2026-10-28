<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { CanvasSize, PaletteColor } from '@mifplace/shared';
import { getCanvas, getCanvasSize, getPalette, placePixel } from './api';
import { drawCanvas, getClickedCell, paintCell } from './canvas';

// Colors from the server, loaded together with the canvas
const palette = ref<PaletteColor[]>([]);

// Canvas size from the server. It does not change, so it is loaded only once.
let canvasSize: CanvasSize | null = null;

// Currently selected color (the first palette color by default)
const selectedColor = ref<PaletteColor | null>(null);

// The <canvas> element
const canvasEl = ref<HTMLCanvasElement | null>(null);

// Is the canvas still loading? Error texts are empty when there is no error.
const loading = ref(true);
const loadError = ref('');
const pixelError = ref('');

// Get the palette, the canvas size (only the first time) and the pixels from the server
// (all at once) and draw the canvas
async function loadCanvas() {
  loading.value = true;
  loadError.value = '';
  try {
    const [colors, size, state] = await Promise.all([
      getPalette(),
      canvasSize ?? getCanvasSize(),
      getCanvas(),
    ]);
    canvasSize = size;
    cellSize.value = VIEWPORT_SIZE / size.width;
    palette.value = colors;
    // After "try again" keep the selected color if the server still has it
    selectedColor.value = colors.find((c) => c.id === selectedColor.value?.id) ?? colors[0];
    if (canvasEl.value) drawCanvas(canvasEl.value, size, state, colors);
  } catch (error) {
    console.error(error);
    loadError.value = 'Nepavyko užkrauti drobės';
  } finally {
    loading.value = false;
  }
}

// Load the canvas when the page opens
onMounted(loadCanvas);

// The viewport is a VIEWPORT_SIZE x VIEWPORT_SIZE px square
const VIEWPORT_SIZE = 640;

// Screen px per cell at zoom 1: the canvas width fills the viewport
const cellSize = ref(1);

// Zoom (1 to 20) and the canvas offset inside the viewport, in screen px
const scale = ref(1);
const x = ref(0);
const y = ref(0);

function clampPosition() {
  if (!canvasSize) return;
  // Size of the canvas on screen
  const width = canvasSize.width * cellSize.value * scale.value;
  const height = canvasSize.height * cellSize.value * scale.value;
  // x and y can't go above 0, or below the point where the far edge would show a gap
  x.value = Math.min(0, Math.max(VIEWPORT_SIZE - width, x.value));
  y.value = Math.min(0, Math.max(VIEWPORT_SIZE - height, y.value));
}

function onWheel(event: WheelEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  const zoom = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newScale = Math.min(20, Math.max(1, scale.value * zoom));
  const ratio = newScale / scale.value;

  x.value = mouseX - (mouseX - x.value) * ratio;
  y.value = mouseY - (mouseY - y.value) * ratio;
  scale.value = newScale;
  clampPosition();
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
  clampPosition();
}

// Send the pixel to the server, draw it only if the server accepts it.
// Ignored at the end of a drag, so moving the canvas does not place a pixel.
async function onCanvasClick(event: MouseEvent) {
  if (moved || !canvasEl.value || !selectedColor.value || !canvasSize) return;

  const cell = getClickedCell(event, canvasSize);
  const { id, color } = selectedColor.value;

  try {
    await placePixel(cell.x, cell.y, id);
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
        :style="{ width: `${VIEWPORT_SIZE}px`, height: `${VIEWPORT_SIZE}px` }"
        @wheel.prevent="onWheel"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="dragging = false"
        @mouseleave="dragging = false"
      >
        <canvas
          id="canvas"
          ref="canvasEl"
          :style="{ transform: `translate(${x}px, ${y}px) scale(${cellSize * scale})` }"
          @click="onCanvasClick"
        ></canvas>
      </div>
      <p v-if="pixelError" class="error">{{ pixelError }}</p>
    </section>

    <section id="color-picker-section">
      <h2>Palette</h2>
      <div id="palette">
        <button
          v-for="swatch in palette"
          :key="swatch.id"
          class="swatch"
          :class="{ selected: swatch.id === selectedColor?.id }"
          :style="{ backgroundColor: swatch.color }"
          :title="swatch.color"
          @click="selectedColor = swatch"
        ></button>
      </div>
    </section>

    <section id="current-color-section">
      <h2>Selected color</h2>
      <div id="current-color-swatch" :style="{ backgroundColor: selectedColor?.color }"></div>
      <span id="current-color-code">{{ selectedColor?.color }}</span>
    </section>
  </main>
</template>
