<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { CanvasSize } from '@mifplace/shared';
import { LOUPE_SIDE, drawLens, lensArea, loupeCell } from '../loupe';
import type { Cell } from '../view';

// The loupe over the selected cell while cells are small: a round lens over the cells around
// it that magnifies the middle most (loupe.ts), with the coming pixel in the middle and a
// glint of glass on top. A click or tap on a cell in it picks that cell, as on the canvas:
// the middle one places the pixel, any other moves the selection. Presses on it stay its
// own, so they never pan the canvas.
const props = defineProps<{
  // The canvas element to read the cells from (one element pixel per cell)
  source: HTMLCanvasElement | null;
  size: CanvasSize;
  cell: Cell;
  // The colour the pixel will get
  color: string | undefined;
  // Centre of the loupe in viewport px
  x: number;
  y: number;
  // Changes whenever something is drawn on the canvas, so the loupe draws again
  drawn: number;
}>();

const emit = defineEmits<{
  pick: [cell: Cell];
  // The cell under the mouse or pen in the loupe, null when it leaves
  hover: [cell: Cell | null];
}>();

const lensEl = ref<HTMLCanvasElement | null>(null);
const hovered = ref<Cell | null>(null);
// Sharp on dense screens: one element pixel per device pixel, at most two per CSS pixel
const side = Math.round(LOUPE_SIDE * Math.min(2, Math.max(1, window.devicePixelRatio || 1)));

function draw() {
  const ctx = lensEl.value?.getContext('2d');
  const sourceCtx = props.source?.getContext('2d');
  if (!ctx || !sourceCtx) return;
  const area = lensArea(props.cell);
  // Off the canvas getImageData gives transparent cells: the lens shows them empty
  const cells = sourceCtx.getImageData(area.x, area.y, area.width, area.height);
  const image = ctx.createImageData(side, side);
  drawLens(
    image.data,
    side,
    { x: area.x, y: area.y, width: area.width, data: cells.data },
    props.cell,
    props.color,
    hovered.value
  );
  ctx.putImageData(image, 0, 0);
}

onMounted(draw);
watch(
  () => [props.cell.x, props.cell.y, props.color, props.drawn, props.source, hovered.value],
  draw
);

function cellAt(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return loupeCell(props.cell, event.clientX - rect.left, event.clientY - rect.top, props.size);
}

// Fingers do not hover: only the mouse and a pen light up the cell under them
function onMove(event: PointerEvent) {
  if (event.pointerType === 'touch') return;
  const cell = cellAt(event);
  if (cell?.x === hovered.value?.x && cell?.y === hovered.value?.y) return;
  hovered.value = cell;
  emit('hover', cell);
}

function onLeave(event: PointerEvent) {
  if (event.pointerType === 'touch') return;
  hovered.value = null;
  emit('hover', null);
}

function onClick(event: MouseEvent) {
  const cell = cellAt(event);
  if (cell) emit('pick', cell);
}
</script>

<template>
  <div
    class="loupe"
    :style="{ left: `${x}px`, top: `${y}px`, width: `${LOUPE_SIDE}px`, height: `${LOUPE_SIDE}px` }"
    @pointerdown.stop
    @pointermove.stop="onMove"
    @pointerleave="onLeave"
    @click.stop="onClick"
  >
    <canvas ref="lensEl" class="lens" :width="side" :height="side"></canvas>
    <span class="glass"></span>
  </div>
</template>

<style scoped>
.loupe {
  position: absolute;
  transform: translate(-50%, -50%);
  overflow: hidden;
  border-radius: 50%;
  /* Cells off the canvas */
  background: var(--ink);
  cursor: pointer;
  pointer-events: auto;
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 30%),
    0 0 0 3px var(--ink),
    0 0 0 4.5px color-mix(in srgb, var(--glow) 85%, transparent),
    0 0 28px 4px color-mix(in srgb, var(--glow) 40%, transparent),
    0 14px 40px rgb(0 0 0 / 50%);
}

.lens {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transition: filter 0.6s ease;
}

/* No live updates while reconnecting: dimmed like the canvas */
.loupe.paused .lens {
  filter: grayscale(0.7) brightness(0.85);
}

/* The glass: a glint at the top left, a soft one opposite and a shade along the rim */
.glass {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  pointer-events: none;
  background:
    radial-gradient(ellipse 34% 22% at 32% 22%, rgb(255 255 255 / 42%), transparent 70%),
    radial-gradient(ellipse 30% 14% at 70% 86%, rgb(255 255 255 / 12%), transparent 70%),
    radial-gradient(circle, transparent 62%, rgb(12 16 48 / 32%) 100%);
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 18%),
    inset 0 -10px 18px rgb(12 16 48 / 25%);
}
</style>
