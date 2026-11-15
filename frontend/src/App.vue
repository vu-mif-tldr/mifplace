<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  fromPosition,
  toPosition,
  type CanvasSize,
  type CanvasState,
  type PaletteColor,
} from '@mifplace/shared';
import { getCanvas, getCanvasSize, getPalette, placePixel } from './api';
import { BLOOM_MS, addBlooms, pruneBlooms, type Bloom, type NewBloom } from './blooms';
import { drawCanvas, getClickedCell, paintCell } from './canvas';
import { glowColor } from './glow';
import { connectLive, type LiveConnection, type LivePixel, type LiveState } from './live';
import { colorName, texts } from './texts';
import {
  cellCenter,
  clampOffset,
  clickAction,
  fitCellSize,
  visiblePart,
  zoomOffset,
  type Cell,
} from './view';

// Colors from the server, loaded together with the canvas
const palette = ref<PaletteColor[]>([]);

// Canvas size from the server. It does not change, so it is loaded only once.
const canvasSize = ref<CanvasSize | null>(null);

// Currently selected color (the first palette color by default)
const selectedColor = ref<PaletteColor | null>(null);

// The cell the next pixel goes to: picked with a click, placed with a second click on it,
// the button or Enter (FR-7)
const selectedCell = ref<Cell | null>(null);
const hoveredCell = ref<Cell | null>(null);

const canvasEl = ref<HTMLCanvasElement | null>(null);
const viewportEl = ref<HTMLDivElement | null>(null);

// Is the canvas still loading? Did loading or the last pixel fail?
const loading = ref(true);
const loadError = ref(false);
const pixelError = ref('');
const placing = ref(false);

// Counts placed pixels, so the ring plays its "placed" animation again for every one
const placedCount = ref(0);

// Share of the cooldown that has passed, 0 to 100, or null when there is none. The server
// has no cooldown yet (FR-8, MP-40/41), so the ring is always full.
const cooldownProgress = ref<number | null>(null);

// Flashes where other people's pixels have just arrived (MP-117)
const blooms = ref<Bloom[]>([]);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// The live connection to /api/ws: other people's pixels arrive here (docs/api.md, section 3).
// While it is reconnecting the updates are paused, and the page says so.
let live: LiveConnection | null = null;
// null until the first connection starts
const liveState = ref<LiveState | null>(null);
const ready = computed(() => !loading.value && !loadError.value);

// The viewport fills the space between the top bar and the dock; its size is measured
const viewWidth = ref(0);
const viewHeight = ref(0);

// Screen px per cell at zoom 1, zoom (1 to 20) and the canvas offset in the viewport, in px
const cellSize = ref(1);
const scale = ref(1);
const x = ref(0);
const y = ref(0);
const cellPx = computed(() => cellSize.value * scale.value);

// Get the palette, the canvas size (only the first time) and the pixels from the server
// (all at once), draw the canvas and follow the live updates from its checkpoint
async function loadCanvas() {
  loading.value = true;
  loadError.value = false;
  try {
    const [colors, size, state] = await Promise.all([
      getPalette(),
      canvasSize.value ?? getCanvasSize(),
      getCanvas(),
    ]);
    canvasSize.value = size;
    scale.value = 1;
    fitToViewport();
    palette.value = colors;
    // After "try again" keep the selected color if the server still has it
    selectedColor.value = colors.find((c) => c.id === selectedColor.value?.id) ?? colors[0];
    showSnapshot(size, state);
  } catch (error) {
    console.error(error);
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

// After a reset: a new snapshot with the palette, the size and the view kept
async function reloadSnapshot() {
  if (!canvasSize.value) return loadCanvas();
  try {
    showSnapshot(canvasSize.value, await getCanvas());
  } catch (error) {
    console.error(error);
    loadError.value = true;
  }
}

// Draws the snapshot and connects from its checkpoint, so nothing between the two is lost.
// The old connection, if any, is closed first: one socket per page.
function showSnapshot(size: CanvasSize, state: CanvasState) {
  if (canvasEl.value) drawCanvas(canvasEl.value, size, state, palette.value);
  live?.close();
  // Only the checkpoint: the connection does not need to keep the pixels of the snapshot alive
  live = connectLive(
    { eventId: state.eventId, timestamp: state.timestamp },
    {
      onPixels: paintLivePixels,
      onReset: reloadSnapshot,
      onState: (state) => (liveState.value = state),
    }
  );
}

// Paints the pixels of one live batch. Our own pixel comes back too, painting it twice is
// fine, and its bloom comes from here. A negative color id is an unpainted cell (the
// background), an id the palette does not have is skipped, as drawCanvas does.
function paintLivePixels(pixels: LivePixel[]) {
  const size = canvasSize.value;
  if (!canvasEl.value || !size) return;
  const colorById = new Map(palette.value.map(({ id, color }) => [id, color]));
  const arrived: NewBloom[] = [];
  for (const { pos, colorId } of pixels) {
    const color = colorId < 0 ? '#ffffff' : colorById.get(colorId);
    if (!color) continue;
    const { x, y } = fromPosition(size, pos);
    paintCell(canvasEl.value, x, y, color);
    if (colorId >= 0) arrived.push({ x, y, color: glowColor(color) });
  }
  if (reducedMotion.matches) return;
  blooms.value = addBlooms(blooms.value, arrived, window.performance.now());
  // Drop the finished ones even if no more pixels arrive
  window.setTimeout(
    () => (blooms.value = pruneBlooms(blooms.value, window.performance.now())),
    BLOOM_MS + 50
  );
}

// Fit the whole canvas into the viewport at zoom 1
function fitToViewport() {
  const size = canvasSize.value;
  if (!size || viewWidth.value === 0 || viewHeight.value === 0) return;
  cellSize.value = fitCellSize(size, viewWidth.value, viewHeight.value);
  clampPosition();
}

function clampPosition() {
  const size = canvasSize.value;
  if (!size) return;
  x.value = clampOffset(x.value, size.width * cellPx.value, viewWidth.value);
  y.value = clampOffset(y.value, size.height * cellPx.value, viewHeight.value);
}

// The viewport is hidden while the canvas loads and changes with the window: fit again
// whenever its size changes
const resizeObserver = new window.ResizeObserver(([entry]) => {
  viewWidth.value = entry.contentRect.width;
  viewHeight.value = entry.contentRect.height;
  fitToViewport();
});

function getCellFromMouse(event: MouseEvent): Cell | null {
  const size = canvasSize.value;
  if (!canvasEl.value || !size) return null;
  const rect = canvasEl.value.getBoundingClientRect();
  const cx = Math.floor(((event.clientX - rect.left) / rect.width) * size.width);
  const cy = Math.floor(((event.clientY - rect.top) / rect.height) * size.height);
  if (cx < 0 || cy < 0 || cx >= size.width || cy >= size.height) return null;
  return { x: cx, y: cy };
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
  hoveredCell.value = getCellFromMouse(event);

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
  hoveredCell.value = null;
}

// A click picks the cell; a second click on the picked cell places the pixel.
// Ignored at the end of a drag, so moving the canvas does not pick anything.
function onCanvasClick(event: MouseEvent) {
  if (moved || !canvasSize.value) return;
  const cell = getClickedCell(event, canvasSize.value);
  if (clickAction(selectedCell.value, cell) === 'place') {
    void place();
  } else {
    selectedCell.value = cell;
    pixelError.value = '';
  }
}

// Send the pixel to the server, draw it only if the server accepts it
async function place() {
  const size = canvasSize.value;
  const cell = selectedCell.value;
  const color = selectedColor.value;
  if (!size || !cell || !color || !canvasEl.value || placing.value) return;

  placing.value = true;
  try {
    // The server checks the position again, it does not trust the client
    await placePixel(toPosition(size, cell.x, cell.y), color.id);
    pixelError.value = '';
    paintCell(canvasEl.value, cell.x, cell.y, color.color);
    placedCount.value++;
  } catch (error) {
    console.error(error);
    pixelError.value = texts.placeFailed;
  } finally {
    placing.value = false;
  }
}

// Enter places the pixel, Escape lets go of the cell. A focused button handles Enter itself.
function onKeyDown(event: KeyboardEvent) {
  if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) {
    return;
  }
  if (event.key === 'Enter') void place();
  if (event.key === 'Escape') selectedCell.value = null;
}

onMounted(() => {
  if (viewportEl.value) resizeObserver.observe(viewportEl.value);
  window.addEventListener('keydown', onKeyDown);
  void loadCanvas();
});
onUnmounted(() => {
  resizeObserver.disconnect();
  window.removeEventListener('keydown', onKeyDown);
  live?.close();
});

const offset = computed(() => ({ x: x.value, y: y.value }));
const glow = computed(() => glowColor(selectedColor.value?.color));
const ring = computed(() => {
  if (!selectedCell.value) return null;
  return {
    ...cellCenter(selectedCell.value, offset.value, cellPx.value),
    size: Math.max(34, cellPx.value + 18),
    cell: Math.max(4, cellPx.value) + 2,
    label: texts.coordinates(selectedCell.value.x, selectedCell.value.y),
  };
});
const hoverRing = computed(() => {
  const cell = hoveredCell.value;
  const picked = selectedCell.value;
  if (!cell || (picked && picked.x === cell.x && picked.y === cell.y)) return null;
  return { ...cellCenter(cell, offset.value, cellPx.value), size: Math.max(18, cellPx.value + 8) };
});
const bloomViews = computed(() => {
  const size = Math.max(48, cellPx.value * 9);
  return blooms.value.map((bloom) => ({
    id: bloom.id,
    color: bloom.color,
    size,
    ...cellCenter(bloom, offset.value, cellPx.value),
  }));
});
// The light behind the canvas, only over its visible part
const halo = computed(() => {
  const size = canvasSize.value;
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
const progress = computed(() => cooldownProgress.value ?? 100);
const hint = computed(() => {
  const cell = selectedCell.value;
  if (!cell || !selectedColor.value) return texts.pickCell;
  return texts.confirmHint(colorName(selectedColor.value.color), cell.x, cell.y);
});
const LIVE_TEXTS: Record<LiveState, string> = {
  connected: texts.live,
  connecting: texts.connecting,
  reconnecting: texts.reconnecting,
};
</script>

<template>
  <div class="page" :style="{ '--glow': glow, '--progress': `${progress}%` }">
    <header class="topbar">
      <span class="brand">
        <svg width="28" height="28" viewBox="0 0 30 30" aria-hidden="true">
          <circle cx="15" cy="15" r="12" fill="none" stroke="var(--glow)" stroke-width="3" />
          <rect x="12" y="12" width="6" height="6" fill="#ffffff" />
        </svg>
        vu.place
      </span>
      <span class="spacer"></span>
      <span v-if="hoveredCell" class="coords">
        {{ texts.coordinates(hoveredCell.x, hoveredCell.y) }}
      </span>
      <span v-if="liveState && ready" class="live-status" :class="liveState" role="status">
        <span class="live-dot"></span>{{ LIVE_TEXTS[liveState] }}
      </span>
    </header>

    <main class="stage">
      <div v-if="loading" class="state">
        <span class="spinner" aria-hidden="true"></span>
        <p>{{ texts.loading }}</p>
      </div>
      <div v-else-if="loadError" class="state">
        <span class="broken-ring" aria-hidden="true"></span>
        <p class="state-title">{{ texts.loadFailed }}</p>
        <p class="state-hint">{{ texts.loadFailedHint }}</p>
        <button type="button" class="pill-button" @click="loadCanvas">{{ texts.retry }}</button>
      </div>

      <div
        v-if="halo && ready"
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
        v-show="ready"
        id="viewport"
        ref="viewportEl"
        :class="{ paused: liveState === 'reconnecting' }"
        :aria-label="texts.canvas"
        @wheel.prevent="onWheel"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="dragging = false"
        @mouseleave="onMouseLeave"
      >
        <canvas
          id="canvas"
          ref="canvasEl"
          :style="{ transform: `translate(${x}px, ${y}px) scale(${cellPx})` }"
          @click="onCanvasClick"
        ></canvas>

        <div class="overlay" aria-hidden="true">
          <span
            v-for="bloom in bloomViews"
            :key="bloom.id"
            class="bloom"
            :style="{
              left: `${bloom.x}px`,
              top: `${bloom.y}px`,
              width: `${bloom.size}px`,
              height: `${bloom.size}px`,
              '--bloom': bloom.color,
            }"
          ></span>
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
          <div v-if="ring" class="ring" :style="{ left: `${ring.x}px`, top: `${ring.y}px` }">
            <span
              :key="placedCount"
              class="ring-circle"
              :class="{ landed: placedCount > 0, failed: pixelError !== '' }"
              :style="{ width: `${ring.size}px`, height: `${ring.size}px` }"
            ></span>
            <span
              class="ring-cell"
              :style="{
                width: `${ring.cell}px`,
                height: `${ring.cell}px`,
                background: selectedColor?.color,
              }"
            ></span>
            <span class="ring-label" :style="{ left: `${ring.size / 2 + 8}px` }">
              {{ ring.label }}
            </span>
          </div>
        </div>
      </div>
    </main>

    <footer v-show="ready" class="dock">
      <p v-if="pixelError" class="toast" role="alert">{{ pixelError }}</p>
      <p v-else class="hint" aria-live="polite">{{ hint }}</p>
      <div class="dock-bar">
        <div class="palette" role="radiogroup" :aria-label="texts.palette">
          <button
            v-for="swatch in palette"
            :key="swatch.id"
            type="button"
            role="radio"
            class="swatch"
            :class="{ selected: swatch.id === selectedColor?.id }"
            :aria-checked="swatch.id === selectedColor?.id"
            :aria-label="colorName(swatch.color)"
            :title="colorName(swatch.color)"
            :style="{ backgroundColor: swatch.color }"
            @click="selectedColor = swatch"
          ></button>
        </div>
        <button
          type="button"
          class="confirm"
          :disabled="!selectedCell || placing"
          :aria-label="
            selectedCell ? texts.place(selectedCell.x, selectedCell.y) : texts.placeNothing
          "
          @click="place"
        >
          <span class="confirm-face">
            <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="confirm-text">{{
              selectedCell ? texts.place(selectedCell.x, selectedCell.y) : texts.placeNothing
            }}</span>
          </span>
        </button>
      </div>
    </footer>
  </div>
</template>
