<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { postPixel, type CanvasSnapshot, type Color } from '../api';
import { cellAt, drawSnapshot } from '../canvas';
import ColorPicker from './ColorPicker.vue';

// The canvas with the colour picker opened by a click on a cell.
// - choosing a colour previews it on the cell;
// - a second click on the chosen colour sends the pixel to the server and keeps it only if the
//   server saved it (clicking another colour only moves the preview);
// - a click outside the picker, Escape or a scale change puts the old colour back.
// While the pixel is being saved the picker is locked: a cancel at that moment would remove
// the pixel from the canvas that the server is about to store.

const props = defineProps<{ palette: Color[]; snapshot: CanvasSnapshot; scale: number }>();
const emit = defineEmits<{ status: [message: string] }>();

interface Selection {
  x: number;
  y: number;
  // The pixel the cell had before the preview.
  original: ImageData;
  anchor: { x: number; y: number };
}

const canvas = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;

// Not a deep ref: ImageData must stay a real object for putImageData.
const selected = shallowRef<Selection | null>(null);
const chosen = ref<Color | null>(null);
const saving = ref(false);

function open(cell: { x: number; y: number }, event: MouseEvent): void {
  if (!ctx) return;
  selected.value = {
    ...cell,
    original: ctx.getImageData(cell.x, cell.y, 1, 1),
    anchor: { x: event.pageX, y: event.pageY },
  };
  chosen.value = null;
  emit('status', '');
}

function close(): void {
  selected.value = null;
  chosen.value = null;
}

function cancel(): void {
  if (saving.value) return;
  const cell = selected.value;
  if (ctx && cell) ctx.putImageData(cell.original, cell.x, cell.y);
  close();
}

async function save(): Promise<void> {
  const cell = selected.value;
  const color = chosen.value;
  if (!ctx || !cell || !color || saving.value) return;
  saving.value = true;
  try {
    await postPixel(cell.y * props.snapshot.width + cell.x, color.id);
  } catch (e) {
    // Not saved (server error, network, timeout): the pixel must not stay on the canvas.
    console.error(e);
    ctx.putImageData(cell.original, cell.x, cell.y);
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
});

onBeforeUnmount(() => {
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
