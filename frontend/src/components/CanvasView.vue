<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { CanvasSize, CanvasState, PaletteColor } from '@mifplace/shared';
import type { Bloom } from '../blooms';
import { drawCanvas, getClickedCell, paintCell } from '../canvas';
import { texts } from '../texts';
import { LOUPE_UNTIL_PX, loupePlace } from '../loupe';
import { cellCenter, clampOffset, fitCellSize, visiblePart, zoomOffset, type Cell } from '../view';
import BloomLayer from './BloomLayer.vue';
import CellLoupe from './CellLoupe.vue';
import SelectionRing from './SelectionRing.vue';

// The canvas with pan and zoom, and everything drawn over it: the selection ring with its
// loupe, the ring under the mouse and the blooms. It only reports clicks on cells; what a click
// means (select or place) is up to the page.
const props = defineProps<{
  size: CanvasSize | null;
  selectedCell: Cell | null;
  selectedColor: string | undefined;
  blooms: Bloom[];
  // No live updates right now (reconnecting): the colours dim
  paused: boolean;
  placedCount: number;
  placeFailed: boolean;
}>();

const emit = defineEmits<{
  // A click on a cell that was not the end of a drag
  pick: [cell: Cell];
  // The cell under the mouse, null when the mouse leaves the canvas
  hover: [cell: Cell | null];
}>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const viewportEl = ref<HTMLDivElement | null>(null);
const hoveredCell = ref<Cell | null>(null);

// The viewport fills the space it is given; its size is measured
const viewWidth = ref(0);
const viewHeight = ref(0);

// Screen px per cell at zoom 1, zoom (1 to 20) and the canvas offset in the viewport, in px
const cellSize = ref(1);
const scale = ref(1);
const x = ref(0);
const y = ref(0);
const cellPx = computed(() => cellSize.value * scale.value);
const offset = computed(() => ({ x: x.value, y: y.value }));

// Counts what is drawn on the canvas element, so the loupe copies it again
const drawn = ref(0);

// Draw a whole snapshot, or one cell, on the canvas element. The size is passed in: the page
// draws right after it learns the size, before the prop has reached this component.
function draw(size: CanvasSize, state: CanvasState, palette: PaletteColor[]) {
  if (canvasEl.value) drawCanvas(canvasEl.value, size, state, palette);
  drawn.value++;
}

function paint(cell: Cell, color: string) {
  if (canvasEl.value) paintCell(canvasEl.value, cell.x, cell.y, color);
  drawn.value++;
}

defineExpose({ draw, paint });

// Fit the whole canvas into the viewport at zoom 1
function fitToViewport() {
  const size = props.size;
  if (!size || viewWidth.value === 0 || viewHeight.value === 0) return;
  cellSize.value = fitCellSize(size, viewWidth.value, viewHeight.value);
  clampPosition();
}

function clampPosition() {
  const size = props.size;
  if (!size) return;
  x.value = clampOffset(x.value, size.width * cellPx.value, viewWidth.value);
  y.value = clampOffset(y.value, size.height * cellPx.value, viewHeight.value);
}

// A new canvas starts with the whole of it in view
watch(
  () => props.size,
  () => {
    scale.value = 1;
    fitToViewport();
  }
);

// The viewport is hidden while the canvas loads and changes with the window: fit again
// whenever its size changes
const resizeObserver = new window.ResizeObserver(([entry]) => {
  viewWidth.value = entry.contentRect.width;
  viewHeight.value = entry.contentRect.height;
  fitToViewport();
});

onMounted(() => {
  if (viewportEl.value) resizeObserver.observe(viewportEl.value);
});
onUnmounted(() => resizeObserver.disconnect());

function cellUnderMouse(event: MouseEvent): Cell | null {
  const size = props.size;
  if (!canvasEl.value || !size) return null;
  const rect = canvasEl.value.getBoundingClientRect();
  const cx = Math.floor(((event.clientX - rect.left) / rect.width) * size.width);
  const cy = Math.floor(((event.clientY - rect.top) / rect.height) * size.height);
  if (cx < 0 || cy < 0 || cx >= size.width || cy >= size.height) return null;
  return { x: cx, y: cy };
}

function setHovered(cell: Cell | null) {
  const old = hoveredCell.value;
  if (old?.x === cell?.x && old?.y === cell?.y) return;
  hoveredCell.value = cell;
  emit('hover', cell);
}

function onWheel(event: WheelEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const newScale = Math.min(20, Math.max(1, scale.value * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
  x.value = zoomOffset(x.value, event.clientX - rect.left, scale.value, newScale);
  y.value = zoomOffset(y.value, event.clientY - rect.top, scale.value, newScale);
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
  setHovered(cellUnderMouse(event));

  if (!dragging) return;

  if (Math.hypot(event.clientX - startX, event.clientY - startY) > 4) moved = true;
  if (!moved) return;

  x.value += event.clientX - lastX;
  y.value += event.clientY - lastY;
  lastX = event.clientX;
  lastY = event.clientY;
  clampPosition();
}

function onMouseLeave() {
  dragging = false;
  setHovered(null);
}

// Ignored at the end of a drag, so moving the canvas does not pick anything
function onCanvasClick(event: MouseEvent) {
  if (moved || !props.size) return;
  emit('pick', getClickedCell(event, props.size));
}

const ring = computed(() =>
  props.selectedCell ? cellCenter(props.selectedCell, offset.value, cellPx.value) : null
);
const ringLabel = computed(() =>
  props.selectedCell ? texts.coordinates(props.selectedCell.x, props.selectedCell.y) : ''
);

// The loupe while cells are too small to tell apart, and only while the cell is in view
const loupe = computed(() => {
  const centre = ring.value;
  if (!centre || cellPx.value >= LOUPE_UNTIL_PX) return null;
  if (centre.x < 0 || centre.y < 0 || centre.x > viewWidth.value || centre.y > viewHeight.value)
    return null;
  return loupePlace(centre, cellPx.value, viewWidth.value, viewHeight.value);
});

// The thin ring under the mouse (MP-105), not over the selected cell
const hoverRing = computed(() => {
  const cell = hoveredCell.value;
  const picked = props.selectedCell;
  if (!cell || (picked && picked.x === cell.x && picked.y === cell.y)) return null;
  return { ...cellCenter(cell, offset.value, cellPx.value), size: Math.max(18, cellPx.value + 8) };
});

// The light behind the canvas, only over its visible part
const halo = computed(() => {
  const size = props.size;
  if (!size) return null;
  return visiblePart(
    {
      x: x.value,
      y: y.value,
      width: size.width * cellPx.value,
      height: size.height * cellPx.value,
    },
    viewWidth.value,
    viewHeight.value
  );
});
</script>

<template>
  <div class="canvas-view">
    <div
      v-if="halo"
      class="halo"
      aria-hidden="true"
      :style="{
        left: `${halo.x}px`,
        top: `${halo.y}px`,
        width: `${halo.width}px`,
        height: `${halo.height}px`,
      }"
    ></div>

    <div
      ref="viewportEl"
      class="viewport"
      :class="{ paused }"
      :aria-label="texts.canvas"
      @wheel.prevent="onWheel"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="dragging = false"
      @mouseleave="onMouseLeave"
    >
      <canvas
        ref="canvasEl"
        class="canvas"
        :style="{ transform: `translate(${x}px, ${y}px) scale(${cellPx})` }"
        @click="onCanvasClick"
      ></canvas>

      <div class="overlay" aria-hidden="true">
        <BloomLayer :blooms="blooms" :offset="offset" :cell-px="cellPx" />
        <span
          v-if="hoverRing"
          class="hover-ring"
          :style="{
            left: `${hoverRing.x}px`,
            top: `${hoverRing.y}px`,
            width: `${hoverRing.size}px`,
            height: `${hoverRing.size}px`,
          }"
        ></span>
        <SelectionRing
          v-if="ring"
          :x="ring.x"
          :y="ring.y"
          :cell-px="cellPx"
          :color="selectedColor"
          :label="ringLabel"
          :placed-count="placedCount"
          :failed="placeFailed"
        />
        <Transition name="loupe">
          <CellLoupe
            v-if="loupe && size && selectedCell"
            :class="{ paused }"
            :source="canvasEl"
            :size="size"
            :cell="selectedCell"
            :color="selectedColor"
            :x="loupe.x"
            :y="loupe.y"
            :drawn="drawn"
            @pick="emit('pick', $event)"
            @hover="setHovered"
          />
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.canvas-view {
  position: absolute;
  inset: 0;
}

.viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: crosshair;
}

.canvas {
  position: absolute;
  left: 0;
  top: 0;
  display: block;
  /* One element pixel per cell, scaled up from the corner by a CSS transform */
  transform-origin: 0 0;
  image-rendering: pixelated;
  background: #ffffff;
  transition: filter 0.6s ease;
}

/* No live updates while reconnecting: the colours dim until the connection is back */
.paused .canvas {
  filter: grayscale(0.7) brightness(0.85);
}

/* The light the canvas casts, behind its visible part */
.halo {
  position: absolute;
  pointer-events: none;
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 14%),
    0 40px 160px 10px color-mix(in srgb, var(--glow) 42%, transparent);
}

.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.hover-ring {
  position: absolute;
  transform: translate(-50%, -50%);
  box-sizing: border-box;
  border-radius: 50%;
  border: 1.5px solid rgb(255 255 255 / 90%);
  box-shadow: 0 0 0 1px rgb(12 16 48 / 60%);
}

/* The loupe opens out of the selected cell */
.loupe-enter-active,
.loupe-leave-active {
  transition:
    opacity 0.16s ease-out,
    transform 0.16s ease-out;
}

.loupe-enter-from,
.loupe-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.6);
}

@media (prefers-reduced-motion: reduce) {
  .canvas {
    transition: none;
  }

  .loupe-enter-active,
  .loupe-leave-active {
    transition: opacity 0.16s ease-out;
  }

  .loupe-enter-from,
  .loupe-leave-to {
    transform: translate(-50%, -50%);
  }
}
</style>
