<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { postPixel, type CanvasSnapshot, type Color } from '../api';
import { cellAt, cellFill, drawSnapshot } from '../canvas';
import { LiveConnection, type LiveEvent } from '../live';
import ColorPicker from './ColorPicker.vue';

// The canvas with the colour picker opened by a click on a cell.
// - choosing a colour previews it on the cell;
// - a second click on the chosen colour sends the pixel to the server and keeps it only if the
//   server saved it (clicking another colour only moves the preview);
// - a click outside the picker, Escape or a scale change puts the old colour back.
// While the pixel is being saved the picker is locked: a cancel at that moment would remove
// the pixel from the canvas that the server is about to store.
//
// Pixels of other people arrive over /api/ws. `cells` is the canvas as the server has it:
// the snapshot plus every event after it. The preview is drawn over it and never written
// into it, so closing the picker redraws the cell from `cells`, even if somebody repainted
// it while the picker was open.

const props = defineProps<{ palette: Color[]; snapshot: CanvasSnapshot; scale: number }>();
const emit = defineEmits<{
  status: [message: string];
  // The server cannot catch this canvas up, the parent must load it again.
  reload: [];
}>();

interface Selection {
  x: number;
  y: number;
  anchor: { x: number; y: number };
}

const canvas = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;

// Not a deep ref: ImageData must stay a real object for putImageData.
const selected = shallowRef<Selection | null>(null);
const chosen = ref<Color | null>(null);
const saving = ref(false);

const cells = props.snapshot.cells.slice();
// The last event applied to cells.
let lastEventId = props.snapshot.lastEventId;
const colors = new Map(props.palette.map((c) => [c.id, c.rgb]));
let live: LiveConnection | null = null;
// Whether the "connection lost" message is shown, so that a reconnect clears only it.
let showsConnectionLost = false;

function positionOf(cell: { x: number; y: number }): number {
  return cell.y * props.snapshot.width + cell.x;
}

// Draws the cell as it is in cells.
function drawCell(position: number): void {
  if (!ctx) return;
  ctx.fillStyle = cellFill(colors, cells[position]);
  ctx.fillRect(position % props.snapshot.width, Math.floor(position / props.snapshot.width), 1, 1);
}

// The cell under the preview keeps the preview, it is redrawn when the picker closes.
function applyEvents(events: LiveEvent[]): void {
  const cell = selected.value;
  const previewed = cell && chosen.value ? positionOf(cell) : -1;
  for (const e of events) {
    // Already in the snapshot.
    if (e.id <= lastEventId) continue;
    cells[e.position] = e.color_id;
    lastEventId = e.id;
    if (e.position !== previewed) drawCell(e.position);
  }
}

function onConnectedChange(connected: boolean): void {
  if (!connected && !showsConnectionLost) {
    showsConnectionLost = true;
    emit('status', 'Connection lost, reconnecting…');
  } else if (connected && showsConnectionLost) {
    showsConnectionLost = false;
    emit('status', '');
  }
}

function open(cell: { x: number; y: number }, event: MouseEvent): void {
  if (!ctx) return;
  selected.value = { ...cell, anchor: { x: event.pageX, y: event.pageY } };
  chosen.value = null;
  emit('status', '');
}

// Closes the picker and replaces the preview with the real colour of the cell.
function close(): void {
  const cell = selected.value;
  selected.value = null;
  chosen.value = null;
  if (cell) drawCell(positionOf(cell));
}

function cancel(): void {
  if (saving.value) return;
  close();
}

async function save(): Promise<void> {
  const cell = selected.value;
  const color = chosen.value;
  if (!ctx || !cell || !color || saving.value) return;
  saving.value = true;
  const position = positionOf(cell);
  try {
    const id = await postPixel(position, color.id);
    // Usually the response comes before the event itself (it is sent in the next batch), so
    // the pixel is put into cells now. If the event or a later one has already arrived, cells
    // is up to date and must not be changed.
    if (id > lastEventId) cells[position] = color.id;
  } catch (e) {
    // Not saved (server error, network, timeout): close() puts the real colour back.
    console.error(e);
    emit('status', 'Could not save the pixel, it was removed from the canvas.');
  }
  close();
  saving.value = false;
}

function onPick(color: Color): void {
  const cell = selected.value;
  if (!ctx || !cell || saving.value) return;
  if (chosen.value?.id === color.id) {
    void save();
    return;
  }
  chosen.value = color;
  ctx.fillStyle = color.rgb;
  ctx.fillRect(cell.x, cell.y, 1, 1);
}

function onDocumentClick(event: MouseEvent): void {
  if (saving.value) return;
  // A click outside an open picker only closes it, even if it landed on another cell.
  if (selected.value) {
    cancel();
    return;
  }
  if (!canvas.value || event.target !== canvas.value) return;
  const cell = cellAt(canvas.value, event);
  if (cell) open(cell, event);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') cancel();
}

onMounted(() => {
  if (!canvas.value) return;
  ctx = drawSnapshot(canvas.value, props.palette, props.snapshot);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeydown);
  live = new LiveConnection(() => lastEventId, {
    onEvents: applyEvents,
    onReload: () => emit('reload'),
    onConnectedChange,
  });
  live.start();
});

onBeforeUnmount(() => {
  live?.stop();
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onKeydown);
});

// The picker position is wrong after the resize.
watch(() => props.scale, cancel);
</script>

<template>
  <canvas
    id="canvas"
    ref="canvas"
    :style="{ width: `${snapshot.width * scale}px`, height: `${snapshot.height * scale}px` }"
  />
  <ColorPicker
    v-if="selected"
    :palette="palette"
    :chosen-id="chosen?.id ?? null"
    :saving="saving"
    :anchor="selected.anchor"
    @pick="onPick"
  />
</template>
