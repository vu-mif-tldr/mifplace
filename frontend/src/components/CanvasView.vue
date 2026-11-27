<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { CanvasSize, CanvasState, PaletteColor } from '@mifplace/shared';
import type { Bloom } from '../blooms';
import { drawCanvas, paintCell, showCanvas } from '../canvas';
import { texts } from '../texts';
import { LOUPE_UNTIL_PX, lensPoint, loupePlace } from '../loupe';
import {
  cellAt,
  cellCenter,
  clampOffset,
  fitCellSize,
  visiblePart,
  zoomOffset,
  type Cell,
} from '../view';
import BloomLayer from './BloomLayer.vue';
import CellLoupe from './CellLoupe.vue';
import CoordsLabel from './CoordsLabel.vue';
import SelectionRing from './SelectionRing.vue';

// The canvas with pan and zoom, and everything drawn over it: the selection ring with its
// loupe, the ring under the mouse and the blooms. It only reports clicks on cells and clicks
// beside the canvas; what a click means (select, place or let go) is up to the page.
const props = defineProps<{
  size: CanvasSize | null;
  selectedCell: Cell | null;
  selectedColor: string | undefined;
  blooms: Bloom[];
  // No live updates right now (reconnecting): the colours dim
  paused: boolean;
}>();

const emit = defineEmits<{
  // A click or tap on a cell that was not the end of a drag or a pinch
  pick: [cell: Cell];
  // A click or tap beside the canvas, in the empty space around it, not ending a gesture
  release: [];
}>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const viewportEl = ref<HTMLDivElement | null>(null);
const hoveredCell = ref<Cell | null>(null);
// Space between a cell (or the ring on it) and its coordinates, px
const LABEL_GAP = 8;

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

// The cells, one pixel each, on a canvas that is not on the page (see canvas.ts). The canvas
// element on the page shows them at the current zoom; the loupe reads them from here.
const source = document.createElement('canvas');

// Counts what is drawn on the source, so the page canvas and the loupe copy it again
const drawn = ref(0);

// Draw a whole snapshot, or one cell, on the source. The size is passed in: the page draws
// right after it learns the size, before the prop has reached this component.
function draw(size: CanvasSize, state: CanvasState, palette: PaletteColor[]) {
  drawCanvas(source, size, state, palette);
  drawn.value++;
}

function paint(cell: Cell, color: string) {
  paintCell(source, cell.x, cell.y, color);
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

// Screen pixels per CSS px. It changes when the window moves to another screen or the page
// is zoomed; a media query for the current ratio reports that.
const pixelRatio = ref(window.devicePixelRatio || 1);
let ratioQuery: ReturnType<typeof window.matchMedia> | null = null;

function watchPixelRatio() {
  ratioQuery?.removeEventListener('change', onRatioChange);
  ratioQuery = window.matchMedia?.(`(resolution: ${pixelRatio.value}dppx)`) ?? null;
  ratioQuery?.addEventListener('change', onRatioChange);
}

function onRatioChange() {
  pixelRatio.value = window.devicePixelRatio || 1;
  watchPixelRatio();
}

onMounted(() => {
  if (viewportEl.value) resizeObserver.observe(viewportEl.value);
  watchPixelRatio();
});
onUnmounted(() => {
  resizeObserver.disconnect();
  ratioQuery?.removeEventListener('change', onRatioChange);
});

// The canvas element in whole screen pixels, so the browser does not scale it again
const canvasBox = computed(() => ({
  width: `${Math.round(viewWidth.value * pixelRatio.value) / pixelRatio.value}px`,
  height: `${Math.round(viewHeight.value * pixelRatio.value) / pixelRatio.value}px`,
}));

// Show the cells again whenever they or the view change; changes within one tick are shown
// once, after the page has updated
watch(
  [drawn, x, y, cellPx, viewWidth, viewHeight, pixelRatio, () => props.size],
  () => {
    const size = props.size;
    if (!canvasEl.value || !size) return;
    showCanvas(canvasEl.value, source, size, {
      width: viewWidth.value,
      height: viewHeight.value,
      x: x.value,
      y: y.value,
      cellPx: cellPx.value,
      pixelRatio: pixelRatio.value,
    });
  },
  { flush: 'post' }
);

function cellUnderPointer(event: MouseEvent): Cell | null {
  const size = props.size;
  if (!viewportEl.value || !size) return null;
  const rect = viewportEl.value.getBoundingClientRect();
  return cellAt(
    { x: event.clientX - rect.left, y: event.clientY - rect.top },
    offset.value,
    cellPx.value,
    size
  );
}

// Whether the cell under the mouse is one in the loupe: its coordinates are shown there
const hoveredInLoupe = ref(false);

function setHovered(cell: Cell | null, inLoupe = false) {
  hoveredInLoupe.value = cell !== null && inLoupe;
  const old = hoveredCell.value;
  if (old?.x === cell?.x && old?.y === cell?.y) return;
  hoveredCell.value = cell;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 20;

// Zoom to `newScale` (kept within 1 to 20) around a point in viewport px, so the spot under
// the point stays under it
function zoomAround(pointX: number, pointY: number, newScale: number) {
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newScale));
  x.value = zoomOffset(x.value, pointX, scale.value, clamped);
  y.value = zoomOffset(y.value, pointY, scale.value, clamped);
  scale.value = clamped;
  clampPosition();
}

function onWheel(event: WheelEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  zoomAround(event.clientX - rect.left, event.clientY - rect.top, scale.value * factor);
}

// The mouse, a pen or the fingers on the viewport, by pointer id, at their last position.
// One pointer pans, two pinch. A press that moves more than 4 px, or any second finger,
// makes the coming click the end of a gesture rather than a tap, so it picks nothing.
const pointers = new Map<number, { x: number; y: number }>();
let moved = false;
let startX = 0;
let startY = 0;

function onPointerDown(event: PointerEvent) {
  if (pointers.size === 0) {
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
  } else {
    moved = true;
  }
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
}

function onPointerMove(event: PointerEvent) {
  // Fingers do not hover: only the mouse and a pen show the cell under them
  if (event.pointerType !== 'touch') setHovered(cellUnderPointer(event));

  const last = pointers.get(event.pointerId);
  if (!last) return;
  const now = { x: event.clientX, y: event.clientY };

  if (pointers.size === 1) {
    if (Math.hypot(now.x - startX, now.y - startY) > 4) moved = true;
    if (!moved) return;
    x.value += now.x - last.x;
    y.value += now.y - last.y;
    pointers.set(event.pointerId, now);
    clampPosition();
    return;
  }

  // Two fingers: the canvas follows their midpoint and zooms by how far apart they move.
  // A third finger only keeps its position, to take over once one of the two is lifted.
  pointers.set(event.pointerId, now);
  const [first, second] = [...pointers.keys()];
  if (event.pointerId !== first && event.pointerId !== second) return;
  const other = pointers.get(event.pointerId === first ? second : first)!;
  const before = Math.hypot(last.x - other.x, last.y - other.y);
  const after = Math.hypot(now.x - other.x, now.y - other.y);
  if (before === 0 || after === 0) return;

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const midX = (now.x + other.x) / 2 - rect.left;
  const midY = (now.y + other.y) / 2 - rect.top;
  x.value += (now.x - last.x) / 2;
  y.value += (now.y - last.y) / 2;
  zoomAround(midX, midY, scale.value * (after / before));
}

// A lifted, cancelled or departed pointer stops counting; the finger that is left pans on
// from where it is
function onPointerUp(event: PointerEvent) {
  pointers.delete(event.pointerId);
}

function onPointerLeave(event: PointerEvent) {
  pointers.delete(event.pointerId);
  if (event.pointerType !== 'touch') setHovered(null);
}

// A click on a cell picks it, a click in the empty space around the canvas lets go. The
// canvas element covers the whole viewport; the loupe over it handles its own clicks.
// Ignored at the end of a drag or a pinch, so moving the canvas does not pick anything.
function onCanvasClick(event: MouseEvent) {
  if (moved || !props.size) return;
  const cell = cellUnderPointer(event);
  if (cell) emit('pick', cell);
  else emit('release');
}

const ring = computed(() =>
  props.selectedCell ? cellCenter(props.selectedCell, offset.value, cellPx.value) : null
);
// With the loupe open the coordinates of the selected cell are in it, not next to the ring
const ringLabel = computed(() =>
  props.selectedCell && !loupe.value
    ? texts.coordinates(props.selectedCell.x, props.selectedCell.y)
    : ''
);

// The loupe while cells are too small to tell apart, and only while the cell is in view
const loupe = computed(() => {
  const centre = ring.value;
  if (!centre || cellPx.value >= LOUPE_UNTIL_PX) return null;
  if (centre.x < 0 || centre.y < 0 || centre.x > viewWidth.value || centre.y > viewHeight.value)
    return null;
  return loupePlace(centre, cellPx.value, viewWidth.value, viewHeight.value);
});

// The thin ring under the mouse (MP-105) with the coordinates next to it, as on the selected
// cell; not over the selected cell, which has its own
const hoverRing = computed(() => {
  const cell = hoveredCell.value;
  const picked = props.selectedCell;
  if (!cell || (picked && picked.x === cell.x && picked.y === cell.y)) return null;
  return {
    ...cellCenter(cell, offset.value, cellPx.value),
    size: Math.max(18, cellPx.value + 8),
    // A cell under the mouse in the loupe has its coordinates there
    label: hoveredInLoupe.value ? '' : texts.coordinates(cell.x, cell.y),
  };
});

// The coordinates in the loupe: of the cell under the mouse there, or else of the selected
// cell, next to the right edge of the cell as the lens shows it
const loupeLabel = computed(() => {
  const place = loupe.value;
  const picked = props.selectedCell;
  if (!place || !picked) return null;
  const cell = hoveredInLoupe.value && hoveredCell.value ? hoveredCell.value : picked;
  const edge = lensPoint(cell.x - picked.x + 0.5, cell.y - picked.y);
  return {
    x: place.x + edge.x + LABEL_GAP,
    y: place.y + edge.y,
    text: texts.coordinates(cell.x, cell.y),
  };
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
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
    >
      <canvas ref="canvasEl" class="canvas" :style="canvasBox" @click="onCanvasClick"></canvas>

      <div class="overlay">
        <BloomLayer :blooms="blooms" :offset="offset" :cell-px="cellPx" />
        <template v-if="hoverRing">
          <span
            class="hover-ring"
            :style="{
              left: `${hoverRing.x}px`,
              top: `${hoverRing.y}px`,
              width: `${hoverRing.size}px`,
              height: `${hoverRing.size}px`,
            }"
          ></span>
          <CoordsLabel
            v-if="hoverRing.label"
            class="hover-label"
            :style="{
              left: `${hoverRing.x + hoverRing.size / 2 + LABEL_GAP}px`,
              top: `${hoverRing.y}px`,
            }"
            :text="hoverRing.label"
          />
        </template>
        <SelectionRing
          v-if="ring"
          :x="ring.x"
          :y="ring.y"
          :cell-px="cellPx"
          :color="selectedColor"
          :label="ringLabel"
        />
        <Transition name="loupe">
          <CellLoupe
            v-if="loupe && size && selectedCell"
            :class="{ paused }"
            :source="source"
            :size="size"
            :cell="selectedCell"
            :color="selectedColor"
            :x="loupe.x"
            :y="loupe.y"
            :drawn="drawn"
            @pick="emit('pick', $event)"
            @hover="setHovered($event, true)"
          />
        </Transition>
        <CoordsLabel
          v-if="loupeLabel"
          class="loupe-label"
          :style="{ left: `${loupeLabel.x}px`, top: `${loupeLabel.y}px` }"
          :text="loupeLabel.text"
        />
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
  /* Pinch and drag move the canvas, not the page */
  touch-action: none;
}

.canvas {
  position: absolute;
  left: 0;
  top: 0;
  display: block;
  /* Drawn in screen pixels (showCanvas); should the browser still scale it a little, it keeps
     the cells sharp */
  image-rendering: pixelated;
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
  box-shadow: 0 0 0 1px rgb(43 0 22 / 60%);
}

.hover-label,
.loupe-label {
  transform: translateY(-50%);
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
</style>
