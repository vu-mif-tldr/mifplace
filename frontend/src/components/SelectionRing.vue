<script setup lang="ts">
import { computed } from 'vue';

// The ring on the selected cell: its colour fills by --progress (the cooldown), it closes
// onto the cell when a pixel is placed and turns into a red dashed ring when that failed
const props = defineProps<{
  // Centre of the cell in viewport px, and px per cell at the current zoom
  x: number;
  y: number;
  cellPx: number;
  // The colour the pixel will get
  color: string | undefined;
  label: string;
  // Changes with every placed pixel, so the "placed" animation plays again
  placedCount: number;
  failed: boolean;
}>();

const size = computed(() => Math.max(34, props.cellPx + 18));
const cell = computed(() => Math.max(4, props.cellPx) + 2);
</script>

<template>
  <div class="selection-ring" :style="{ left: `${x}px`, top: `${y}px` }">
    <span
      :key="placedCount"
      class="circle"
      :class="{ landed: placedCount > 0, failed }"
      :style="{ width: `${size}px`, height: `${size}px` }"
    ></span>
    <span
      class="cell"
      :style="{ width: `${cell}px`, height: `${cell}px`, background: color }"
    ></span>
    <span class="label" :style="{ left: `${size / 2 + 8}px` }">{{ label }}</span>
  </div>
</template>

<style scoped>
.selection-ring {
  position: absolute;
  width: 0;
  height: 0;
}

.circle {
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: conic-gradient(var(--glow) var(--progress), rgb(255 255 255 / 18%) 0);
  mask: radial-gradient(circle closest-side, transparent calc(100% - 4px), #000 calc(100% - 3px));
  box-shadow: 0 0 22px 2px color-mix(in srgb, var(--glow) 60%, transparent);
  animation: breathe 2.4s ease-in-out infinite;
}

.circle.landed {
  animation:
    land 0.5s ease-out,
    breathe 2.4s ease-in-out 0.5s infinite;
}

.circle.failed {
  box-sizing: border-box;
  background: none;
  mask: none;
  border: 3px dashed var(--error);
  box-shadow: 0 0 0 1.5px var(--ink);
  animation: none;
}

@keyframes breathe {
  50% {
    transform: translate(-50%, -50%) scale(1.06);
  }
}

@keyframes land {
  50% {
    transform: translate(-50%, -50%) scale(0.3);
  }
}

.cell {
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(-50%, -50%);
  box-shadow:
    0 0 0 1px var(--ink),
    0 0 0 2.5px #ffffff;
}

.label {
  position: absolute;
  top: -14px;
  padding: 5px 11px;
  border-radius: 14px;
  background: var(--ink);
  color: #ffffff;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 12%);
}

@media (prefers-reduced-motion: reduce) {
  .circle,
  .circle.landed {
    animation: none;
  }
}
</style>
