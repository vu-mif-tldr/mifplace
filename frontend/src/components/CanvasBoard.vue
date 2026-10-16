<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { postPixel, type CanvasSnapshot, type Color } from '../api';
import { cellAt, cellFill, cellsOnLine, drawSnapshot, type Cell } from '../canvas';
import { LiveConnection, type LiveEvent } from '../live';
import { logger } from '../log';

const log = logger('draw');

// The canvas you draw on with the colour chosen in the palette: a click paints one cell,
// dragging with the button held paints every cell under the cursor. Each cell is drawn at once
// and sent to the server on its own, without confirmation; if the server does not store it, the
// cell goes back to the colour the server has.
//
// Pixels of other people arrive over /api/ws. `cells` is the canvas as the server has it:
// the snapshot plus every event after it. A cell of ours still being saved is drawn over it
// and not repainted by incoming events until its request finishes.

const props = defineProps<{
  palette: Color[];
  snapshot: CanvasSnapshot;
  scale: number;
  // The colour to draw with.
  color: Color;
}>();
const emit = defineEmits<{
  status: [message: string];
  // The server cannot catch this canvas up, the parent must load it again.
  reload: [];
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;

const cells = props.snapshot.cells.slice();
// The last event applied to cells.
let lastEventId = props.snapshot.lastEventId;
const colors = new Map(props.palette.map((c) => [c.id, c.rgb]));
let live: LiveConnection | null = null;
// Whether the "connection lost" message is shown, so that a reconnect clears only it.
let showsConnectionLost = false;

// Cells of ours being saved: position -> colour drawn there and the request number. A newer
// request for the same cell replaces the entry, so only the last one decides what is drawn
// when it finishes.
const saving = new Map<number, { colorId: number; request: number }>();
let requestCount = 0;
// The cell under the cursor while the button is held, null otherwise.
let stroke: Cell | null = null;

function positionOf(cell: Cell): number {
  return cell.y * props.snapshot.width + cell.x;
}

function fill(position: number, colorId: number): void {
  if (!ctx) return;
  ctx.fillStyle = cellFill(colors, colorId);
  ctx.fillRect(position % props.snapshot.width, Math.floor(position / props.snapshot.width), 1, 1);
}

// Draws the cell as it is in cells, or our colour while it is being saved.
function drawCell(position: number): void {
  fill(position, saving.get(position)?.colorId ?? cells[position]);
}

function applyEvents(events: LiveEvent[]): void {
  for (const e of events) {
    // Already in the snapshot.
    if (e.id <= lastEventId) continue;
    cells[e.position] = e.color_id;
    lastEventId = e.id;
    drawCell(e.position);
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

async function paint(cell: Cell): Promise<void> {
  const position = positionOf(cell);
  const colorId = props.color.id;
  // Already this colour: nothing to send.
  if ((saving.get(position)?.colorId ?? cells[position]) === colorId) return;
  const request = ++requestCount;
  saving.set(position, { colorId, request });
  fill(position, colorId);
  const started = performance.now();
  try {
    const id = await postPixel(position, colorId);
    log.debug('pixel saved', {
      position,
      color: colorId,
      id,
      ms: Math.round(performance.now() - started),
    });
    // Usually the response comes before the event itself (it is sent in the next batch), so
    // the pixel is put into cells now. If the event or a later one has already arrived, cells
    // is up to date and must not be changed.
    if (id > lastEventId) cells[position] = colorId;
  } catch (e) {
    log.warn('pixel not saved, removed from the canvas', { position, color: colorId }, e);
    emit('status', 'Could not save a pixel, it was removed from the canvas.');
  }
  // A newer request for this cell is still running, it draws the cell when it finishes.
  if (saving.get(position)?.request !== request) return;
  saving.delete(position);
  drawCell(position);
}

function onPointerDown(event: PointerEvent): void {
  if (!canvas.value || event.button !== 0) return;
  const cell = cellAt(canvas.value, event);
  if (!cell) return;
  // Keeps the pointer events coming while the cursor leaves the canvas during a stroke.
  canvas.value.setPointerCapture(event.pointerId);
  stroke = cell;
  void paint(cell);
}

function onPointerMove(event: PointerEvent): void {
  if (!canvas.value || !stroke) return;
  const cell = cellAt(canvas.value, event);
  if (!cell || (cell.x === stroke.x && cell.y === stroke.y)) return;
  // A fast move skips cells, the line between the two positions fills them.
  for (const c of cellsOnLine(stroke, cell).slice(1)) void paint(c);
  stroke = cell;
}

function onPointerUp(): void {
  stroke = null;
}

onMounted(() => {
  if (!canvas.value) return;
  ctx = drawSnapshot(canvas.value, props.palette, props.snapshot);
  live = new LiveConnection(() => lastEventId, {
    onEvents: applyEvents,
    onReload: () => emit('reload'),
    onConnectedChange,
  });
  live.start();
});

onBeforeUnmount(() => {
  live?.stop();
});
</script>

<template>
  <canvas
    id="canvas"
    ref="canvas"
    :style="{ width: `${snapshot.width * scale}px`, height: `${snapshot.height * scale}px` }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  />
</template>
