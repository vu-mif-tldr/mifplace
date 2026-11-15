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
import type { NewBloom } from './blooms';
import { glowColor } from './glow';
import { connectLive, type LiveConnection, type LivePixel, type LiveState } from './live';
import { colorName, texts } from './texts';
import { useActivity } from './useActivity';
import { useBlooms } from './useBlooms';
import { useTopLights } from './useTopLights';
import { clickAction, type Cell } from './view';
import ActivityTicker from './components/ActivityTicker.vue';
import CanvasView from './components/CanvasView.vue';
import LoadState from './components/LoadState.vue';
import PaletteDock from './components/PaletteDock.vue';
import TopBar from './components/TopBar.vue';
import TopLights from './components/TopLights.vue';

// The canvas page: loads the canvas, follows the live updates and places pixels. How things
// look is up to the components; this file holds the state and wires them together.

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

const canvasView = ref<InstanceType<typeof CanvasView> | null>(null);
const ticker = ref<InstanceType<typeof ActivityTicker> | null>(null);

// Is the canvas still loading? Did loading or the last pixel fail?
const loading = ref(true);
const loadError = ref(false);
const pixelError = ref('');
const placing = ref(false);
const ready = computed(() => !loading.value && !loadError.value);

// Counts placed pixels, so the ring plays its "placed" animation again for every one
const placedCount = ref(0);

// Share of the cooldown that has passed, 0 to 100, or null when there is none. The server
// has no cooldown yet (FR-8, MP-40/41), so the ring is always full.
const cooldownProgress = ref<number | null>(null);

// Flashes where other people's pixels have just arrived (MP-117)
const { blooms, add: addBlooms } = useBlooms();

// Lights from the top of the page in the colours of new pixels, at most three at once
const { lights: topLights, add: addTopLights } = useTopLights();

// How busy the canvas is, for the light of the page
const { summary: activity, record: recordActivity } = useActivity();

// The live connection to /api/ws: other people's pixels arrive here (docs/api.md, section 3).
// While it is reconnecting the updates are paused, and the page says so.
let live: LiveConnection | null = null;
// null until the first connection starts
const liveState = ref<LiveState | null>(null);
// How many pages are connected, from the server; null until it says
const online = ref<number | null>(null);

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
  canvasView.value?.draw(size, state, palette.value);
  live?.close();
  // Only the checkpoint: the connection does not need to keep the pixels of the snapshot alive
  live = connectLive(
    { eventId: state.eventId, timestamp: state.timestamp },
    {
      onPixels: paintLivePixels,
      onReset: reloadSnapshot,
      onState: (state) => (liveState.value = state),
      onOnline: (count) => (online.value = count),
    }
  );
}

// Paints the pixels of one live batch. Our own pixel comes back too, painting it twice is
// fine, and its bloom comes from here. A negative color id is an unpainted cell (the
// background), an id the palette does not have is skipped, as drawCanvas does.
function paintLivePixels(pixels: LivePixel[]) {
  const size = canvasSize.value;
  if (!size) return;
  const colorById = new Map(palette.value.map(({ id, color }) => [id, color]));
  const arrived: NewBloom[] = [];
  for (const { pos, colorId } of pixels) {
    const color = colorId < 0 ? '#ffffff' : colorById.get(colorId);
    if (!color) continue;
    const cell = fromPosition(size, pos);
    canvasView.value?.paint(cell, color);
    if (colorId >= 0) arrived.push({ ...cell, color });
  }
  // Blooms and top lights are light: a dark pixel shines in the neutral light. The ticker shows
  // the real colour.
  const lights = arrived.map((pixel) => ({ ...pixel, color: glowColor(pixel.color) }));
  addBlooms(lights);
  addTopLights(lights.map((pixel) => pixel.color));
  recordActivity(arrived);
  ticker.value?.announce(arrived);
}

// A click picks the cell; a second click on the picked cell places the pixel
function onPick(cell: Cell) {
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
  if (!size || !cell || !color || placing.value) return;

  placing.value = true;
  try {
    // The server checks the position again, it does not trust the client
    await placePixel(toPosition(size, cell.x, cell.y), color.id);
    pixelError.value = '';
    canvasView.value?.paint(cell, color.color);
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
  window.addEventListener('keydown', onKeyDown);
  void loadCanvas();
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  live?.close();
});

const hint = computed(() => {
  const cell = selectedCell.value;
  if (!cell || !selectedColor.value) return texts.pickCell;
  return texts.confirmHint(colorName(selectedColor.value.color), cell.x, cell.y);
});
const placeLabel = computed(() =>
  selectedCell.value ? texts.place(selectedCell.value.x, selectedCell.value.y) : texts.placeNothing
);
</script>

<template>
  <div
    class="page"
    :style="{
      '--glow': glowColor(selectedColor?.color),
      '--progress': `${cooldownProgress ?? 100}%`,
      '--energy': activity.energy,
    }"
  >
    <TopLights :lights="topLights" />
    <TopBar
      :hovered-cell="hoveredCell"
      :live-state="ready ? liveState : null"
      :online="liveState === 'connected' ? online : null"
    />

    <main class="stage">
      <LoadState v-if="!ready" :failed="loadError" @retry="loadCanvas" />
      <CanvasView
        v-show="ready"
        ref="canvasView"
        :size="canvasSize"
        :selected-cell="selectedCell"
        :selected-color="selectedColor?.color"
        :blooms="blooms"
        :paused="liveState === 'reconnecting'"
        :placed-count="placedCount"
        :place-failed="pixelError !== ''"
        @pick="onPick"
        @hover="hoveredCell = $event"
      />
    </main>

    <PaletteDock
      v-show="ready"
      :palette="palette"
      :selected-id="selectedColor?.id"
      :hint="hint"
      :error="pixelError"
      :place-label="placeLabel"
      :can-place="selectedCell !== null && !placing"
      @select="selectedColor = $event"
      @place="place"
    />

    <ActivityTicker
      v-show="ready"
      ref="ticker"
      :selected-color="selectedColor?.color"
      :selected-cell="selectedCell"
    />
  </div>
</template>

<style scoped>
/* A dark night lit by the colour the user holds (--glow). The light is brighter while many
   people paint (--energy, 0 to 1) and dims when the canvas is quiet. New pixels light it
   from the top for a moment (TopLights, behind the content: hence the own stacking context). */
.page {
  position: relative;
  isolation: isolate;
  height: 100dvh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  overflow: hidden;
  background:
    radial-gradient(
      60% 55% at 50% 100%,
      color-mix(in srgb, var(--glow) calc(28% + var(--energy) * 24%), transparent),
      transparent
    ),
    radial-gradient(
      45% 45% at 50% 45%,
      color-mix(in srgb, var(--glow) calc(10% + var(--energy) * 10%), transparent),
      transparent
    ),
    var(--ink);
  transition:
    --glow 1.5s ease,
    --energy 2s ease;
}

.stage {
  position: relative;
  margin: 0 16px;
}

@media (max-width: 720px) {
  .stage {
    margin: 0 4px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .page {
    transition: none;
  }
}
</style>
