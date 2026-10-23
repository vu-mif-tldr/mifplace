<script setup lang="ts">
import { ref } from 'vue';
import { paintPixel } from './canvas';
import { PALETTE } from './palette';

// Šiuo metu pasirinkta spalva (pradžioje juoda)
const selectedColor = ref(PALETTE[0]);

// Nuoroda į <canvas> elementą (ref="canvasEl" template'e)
const canvasEl = ref<HTMLCanvasElement | null>(null);

const scale = ref(1);
const x = ref(0);
const y = ref(0);
const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 600;

function clampPosition() {
  // x and y can't go above 0, or below the point where the far edge would show a gap
  x.value = Math.min(0, Math.max(VIEW_WIDTH - VIEW_WIDTH * scale.value, x.value));
  y.value = Math.min(0, Math.max(VIEW_HEIGHT - VIEW_HEIGHT * scale.value, y.value));
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

function onCanvasClick(event: MouseEvent) {
  if (moved || !canvasEl.value) return;
  paintPixel(canvasEl.value, selectedColor.value, event);
}
</script>

<template>
  <main>
    <section id="canvas-section">
      <h2>MIF PLACE</h2>
      <div
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
          width="800"
          height="600"
          :style="{ transform: `translate(${x}px, ${y}px) scale(${scale})` }"
          @click="onCanvasClick"
        ></canvas>
      </div>
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
