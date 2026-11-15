<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef, watch } from 'vue';
import { addItem, emptyBelt, screenX, step, type Belt } from '../belt';
import { MAX_BATCH_FOR_BLOOMS, type NewBloom } from '../blooms';
import { outlineFor } from '../glow';
import { texts } from '../texts';
import type { Cell } from '../view';

// The strip at the bottom: a belt of messages running from right to left (belt.ts).
// - every new pixel: "● x, y", shown at once, pushing the belt if there is no room;
// - the selected cell: "Tavo: ● x, y", one message that follows the selection; it waits its
//   turn behind the right edge and never pushes;
// - "Dabar ramu..." when nothing has happened for a while.
// Places only, never people (NFR-11).
const props = defineProps<{
  selectedCell: Cell | null;
  // The colour of the selected swatch
  selectedColor: string | undefined;
}>();

type Message = {
  id: number;
  kind: 'pixel' | 'you' | 'quiet';
  x: number;
  y: number;
  color: string;
};

// "Dabar ramu..." comes when the belt is empty and no pixel has arrived for this long, ms
const QUIET_AFTER_MS = 10_000;

let nextId = 0;
let belt: Belt = emptyBelt();
const messages = new Map<number, Message>();
// Added, waiting one frame to be measured before they go on the belt
let pending: Message[] = [];
let lastEvent = -Infinity;
let quietShown = false;
let stripWidth = 0;

// What is drawn: every message with its place on the strip (pending ones out of sight)
type Drawn = Message & { left: number; dot: string };
const drawn = shallowRef<Drawn[]>([]);

const elements = new Map<number, HTMLElement>();
function remember(id: number, el: unknown) {
  if (el instanceof window.HTMLElement) elements.set(id, el);
  else elements.delete(id);
}

const moving = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function enqueue(kind: Message['kind'], x = 0, y = 0, color = '') {
  const message = { id: ++nextId, kind, x, y, color };
  messages.set(message.id, message);
  pending.push(message);
  redraw();
}

// New pixels from the live stream. A catch-up batch after a reconnect is from the past.
function announce(pixels: NewBloom[]) {
  if (pixels.length === 0 || pixels.length > MAX_BATCH_FOR_BLOOMS) return;
  lastEvent = window.performance.now();
  for (const pixel of pixels) enqueue('pixel', pixel.x, pixel.y, pixel.color);
}

defineExpose({ announce });

// The selected cell is one message: while it is on the belt it shows the selection as it is
// now; once it has left, the next change of the selection adds it again. Without a selection
// it keeps its last values.
function you() {
  return [...messages.values()].find((message) => message.kind === 'you');
}
watch(
  () => [props.selectedCell, props.selectedColor] as const,
  ([cell, color]) => {
    if (!cell || !color) return;
    const message = you();
    if (message) Object.assign(message, { x: cell.x, y: cell.y, color });
    else enqueue('you', cell.x, cell.y, color);
    redraw();
  },
  { immediate: true }
);

function redraw() {
  const onBelt = belt.items.map((item) => ({ id: item.id, left: screenX(belt, item) }));
  const waiting = pending.map((message) => ({ id: message.id, left: stripWidth + 10_000 }));
  drawn.value = [...onBelt, ...waiting].flatMap(({ id, left }) => {
    const message = messages.get(id);
    return message ? [{ ...message, left, dot: outlineFor(message.color || '#c8cdea') }] : [];
  });
}

function frame(dt: number, now: number) {
  if (stripWidth === 0) return;

  // The first "Dabar ramu..." shows at once; later ones come in from the right edge
  if (belt.items.length === 0 && pending.length === 0 && now - lastEvent >= QUIET_AFTER_MS) {
    enqueue('quiet');
  }
  // A message goes on the belt once it has been drawn and measured, in the order of arrival
  while (pending.length > 0) {
    const width = elements.get(pending[0].id)?.offsetWidth ?? 0;
    if (width === 0) break;
    const message = pending.shift()!;
    // Only a new pixel pushes the belt; the first "Dabar ramu..." just starts in view
    const important = message.kind === 'pixel' || (message.kind === 'quiet' && !quietShown);
    if (message.kind === 'quiet') quietShown = true;
    belt = addItem(belt, { id: message.id, width }, stripWidth, important);
  }

  const widths = new Map(
    belt.items.map((item) => [item.id, elements.get(item.id)?.offsetWidth || item.width])
  );
  belt = step(belt, dt, widths, moving);
  const kept = new Set([...belt.items, ...pending].map((item) => item.id));
  for (const id of messages.keys()) if (!kept.has(id)) messages.delete(id);
  redraw();
}

let request = 0;
let last = 0;
function loop(time: number) {
  frame(last ? (time - last) / 1000 : 0, time);
  last = time;
  request = window.requestAnimationFrame(loop);
}

// The strip is hidden while the canvas loads; it starts once it has a width
const resizeObserver = new window.ResizeObserver(([entry]) => {
  stripWidth = entry.contentRect.width;
});
const stripEl = shallowRef<HTMLElement | null>(null);
onMounted(() => {
  if (stripEl.value) resizeObserver.observe(stripEl.value);
  request = window.requestAnimationFrame(loop);
});
onUnmounted(() => {
  resizeObserver.disconnect();
  window.cancelAnimationFrame(request);
});
</script>

<template>
  <section ref="stripEl" class="ticker" :aria-label="texts.activity">
    <ul>
      <li
        v-for="message in drawn"
        :key="message.id"
        :ref="(el) => remember(message.id, el)"
        :style="{ transform: `translateX(${message.left}px)` }"
      >
        <template v-if="message.kind === 'pixel'">
          <span class="dot" :style="{ background: message.color, borderColor: message.dot }"></span>
          {{ texts.coordinates(message.x, message.y) }}
        </template>
        <template v-else-if="message.kind === 'you'">
          {{ texts.yours }}
          <span class="dot" :style="{ background: message.color, borderColor: message.dot }"></span>
          {{ texts.coordinates(message.x, message.y) }}
        </template>
        <template v-else>{{ texts.quiet }}</template>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.ticker {
  position: relative;
  height: 36px;
  overflow: hidden;
  border-top: 1px solid rgb(255 255 255 / 8%);
  background: rgb(12 16 48 / 60%);
  font-family: var(--font-live);
  font-size: 13px;
  font-weight: 500;
  /* Digits of one width, so coordinates do not jump */
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Every message is placed on its own by the belt */
li {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  white-space: nowrap;
  will-change: transform;
}

/* The pixel colour with an outline that shows on any background */
.dot {
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border: 1.5px solid;
  border-radius: 50%;
}

@media (max-width: 720px) {
  .ticker {
    height: 32px;
    font-size: 12px;
  }

  li {
    height: 32px;
  }
}
</style>
