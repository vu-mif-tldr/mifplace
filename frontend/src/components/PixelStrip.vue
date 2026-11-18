<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

// The strip of coloured pixels along the top of the page: decoration only. The pixels thin out
// downwards and pop in one after another when the page opens. Always the same pattern (a fixed
// seed). As many columns as fit at about CELL px each, so the strip runs from edge to edge in
// whole pixels. Drawn as one SVG with crisp edges: neighbours share an edge exactly, with no
// hairline gaps or overlaps between them.
const CELL = 22;
const PHONE_CELL = 16;
const MAX_COLUMNS = 120;
const ROWS = 3;
const COLORS = [
  '#FFD635',
  '#2F7FE0',
  '#E4002B',
  '#FFFFFF',
  '#51E9F4',
  '#FF99AA',
  '#7EED56',
  '#FF6A13',
  '#811E9F',
  '#00A368',
];

let seed = 11;
function random() {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

// Column by column, so a wider screen adds columns at the end and keeps the ones before
const PATTERN = Array.from({ length: MAX_COLUMNS }, (_, x) =>
  Array.from({ length: ROWS }, (_, y) => {
    const shown = random() < 0.85 - y * (0.75 / ROWS);
    const color = shown ? COLORS[Math.floor(random() * COLORS.length)] : null;
    const delay = `${(y * 0.06 + (x % 50) * 0.012 + random() * 0.08).toFixed(2)}s`;
    return color ? { x, y, color, delay } : null;
  })
);

const stripEl = ref<InstanceType<typeof window.SVGSVGElement> | null>(null);
const columns = ref(48);

const pixels = computed(() =>
  PATTERN.slice(0, columns.value)
    .flat()
    .filter((pixel) => pixel !== null)
);

function fit(width: number) {
  if (width <= 0) return;
  // A narrow or a short window gets smaller pixels, so the canvas keeps its room
  const cell = width <= 720 || window.innerHeight < 820 ? PHONE_CELL : CELL;
  columns.value = Math.min(MAX_COLUMNS, Math.max(1, Math.round(width / cell)));
}

let observer: InstanceType<typeof window.ResizeObserver> | null = null;
onMounted(() => {
  if (!stripEl.value || typeof window.ResizeObserver === 'undefined') return;
  observer = new window.ResizeObserver(([entry]) => fit(entry.contentRect.width));
  observer.observe(stripEl.value);
});
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <svg
    ref="stripEl"
    class="pixel-strip"
    :viewBox="`0 0 ${columns} ${ROWS}`"
    preserveAspectRatio="none"
    shape-rendering="crispEdges"
    :style="{ aspectRatio: `${columns} / ${ROWS}` }"
  >
    <rect
      v-for="pixel in pixels"
      :key="`${pixel.x},${pixel.y}`"
      :x="pixel.x"
      :y="pixel.y"
      width="1"
      height="1"
      :fill="pixel.color"
      :style="{ animationDelay: pixel.delay }"
    />
  </svg>
</template>

<style scoped>
.pixel-strip {
  display: block;
  width: 100%;
  height: auto;
  pointer-events: none;
}

rect {
  transform-box: fill-box;
  transform-origin: center;
  animation: pop-in 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
}

@keyframes pop-in {
  from {
    opacity: 0;
    transform: scale(0.3);
  }

  to {
    opacity: 1;
    transform: none;
  }
}
</style>
