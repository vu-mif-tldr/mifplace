<script setup lang="ts">
import { computed } from 'vue';
import { ringSize } from '../view';
import CoordsLabel from './CoordsLabel.vue';

// The mark on the selected cell: the coming pixel covers exactly its cell, nothing of the
// cells around. Small cells get four ticks pointing at it from one cell away, large ones a
// frame inside the cell.
const props = defineProps<{
  // Centre of the cell in viewport px, and px per cell at the current zoom
  x: number;
  y: number;
  cellPx: number;
  // The colour the pixel will get
  color: string | undefined;
  // Empty while the coordinates are shown elsewhere (in the loupe)
  label: string;
}>();

// Cells this large or larger have room for a frame inside
const FRAMED_FROM_PX = 8;

const size = computed(() => ringSize(props.cellPx));
const framed = computed(() => props.cellPx >= FRAMED_FROM_PX);

// The ticks run from one cell away from the cell to just inside ringSize
const ticks = computed(() => {
  const from = props.cellPx * 1.5;
  const to = size.value / 2 - 6;
  return to - from >= 3 ? { from, to } : null;
});
</script>

<template>
  <div class="selection-ring" :style="{ left: `${x}px`, top: `${y}px` }">
    <svg
      v-if="ticks"
      class="ticks"
      :width="size"
      :height="size"
      :viewBox="`${-size / 2} ${-size / 2} ${size} ${size}`"
    >
      <g v-for="angle in [0, 90, 180, 270]" :key="angle" :transform="`rotate(${angle})`">
        <line class="tick-shade" :x1="ticks.from" :x2="ticks.to" y1="0" y2="0" />
        <line class="tick" :x1="ticks.from" :x2="ticks.to" y1="0" y2="0" />
      </g>
    </svg>
    <span
      class="cell"
      :class="{ framed }"
      :style="{ width: `${cellPx}px`, height: `${cellPx}px`, background: color }"
    ></span>
    <CoordsLabel v-if="label" class="label" :style="{ left: `${size / 2 + 8}px` }" :text="label" />
  </div>
</template>

<style scoped>
.selection-ring {
  position: absolute;
  width: 0;
  height: 0;
}

.ticks {
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(-50%, -50%);
  overflow: visible;
}

.tick,
.tick-shade {
  stroke-linecap: round;
}

.tick {
  stroke: #ffffff;
  stroke-width: 1.5;
}

/* A dark edge, so the ticks show on white cells too */
.tick-shade {
  stroke: var(--ink);
  stroke-width: 3.5;
  stroke-opacity: 0.6;
}

/* Exactly the cell: the pixel as it will be, nothing over its neighbours */
.cell {
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(-50%, -50%);
}

.cell.framed {
  box-shadow:
    inset 0 0 0 2px #ffffff,
    inset 0 0 0 3px var(--ink);
}

.label {
  top: -14px;
}
</style>
