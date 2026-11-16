<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { addItem, emptyBelt, screenX, step, type Belt } from '../belt';
import { MAX_BATCH_FOR_BLOOMS, type NewBloom } from '../blooms';
import { outlineFor } from '../glow';
import { texts } from '../texts';

// The strip at the bottom: a belt of new pixels running from right to left (belt.ts), each
// "+1 ●" in its colour, shown at once and pushing the belt if there is no room. Another pixel of
// the same colour makes it "+2", and so on, while the message is fully in view; once it has begun
// to leave on the left, a new message comes instead. "Dabar ramu..." is not on the belt: it comes
// out from the left edge once the canvas has been quiet for a while and stays there until the
// next new pixel sends it away. Places only, never people (NFR-11).
type Message = {
  id: number;
  color: string;
  count: number;
};

// "Dabar ramu..." comes when no pixel has arrived for this long and the last one has left, ms
const QUIET_AFTER_MS = 10_000;

let nextId = 0;
let belt: Belt = emptyBelt();
const messages = new Map<number, Message>();
// Added, waiting one frame to be measured before they go on the belt
let pending: Message[] = [];
let lastEvent = -Infinity;
let stripWidth = 0;
const quiet = ref(false);

// What is drawn: every message with its place on the strip (pending ones out of sight)
type Drawn = Message & { left: number; dot: string };
const drawn = shallowRef<Drawn[]>([]);

const elements = new Map<number, HTMLElement>();
function remember(id: number, el: unknown) {
  if (el instanceof window.HTMLElement) elements.set(id, el);
  else elements.delete(id);
}

// New pixels from the live stream. A catch-up batch after a reconnect is from the past.
function announce(pixels: NewBloom[]) {
  if (pixels.length === 0 || pixels.length > MAX_BATCH_FOR_BLOOMS) return;
  lastEvent = window.performance.now();
  quiet.value = false;
  for (const { color } of pixels) {
    const same = growing(color);
    if (same) {
      same.count += 1;
      continue;
    }
    const message = { id: ++nextId, color, count: 1 };
    messages.set(message.id, message);
    pending.push(message);
  }
  redraw();
}

// The message of this colour that can still count: the newest one, while its left edge is in
// view. One still waiting to be measured is the newest of all.
function growing(color: string): Message | undefined {
  const sameColor = (message: Message | undefined) =>
    message?.color.toUpperCase() === color.toUpperCase();
  const waiting = [...pending].reverse().find(sameColor);
  if (waiting) return waiting;
  const item = [...belt.items].reverse().find((item) => sameColor(messages.get(item.id)));
  return item && screenX(belt, item) >= 0 ? messages.get(item.id) : undefined;
}

defineExpose({ announce });

function redraw() {
  const onBelt = belt.items.map((item) => ({ id: item.id, left: screenX(belt, item) }));
  const waiting = pending.map((message) => ({ id: message.id, left: stripWidth + 10_000 }));
  drawn.value = [...onBelt, ...waiting].flatMap(({ id, left }) => {
    const message = messages.get(id);
    return message ? [{ ...message, left, dot: outlineFor(message.color) }] : [];
  });
}

function frame(dt: number, now: number) {
  if (stripWidth === 0) return;

  const pixelsInView = belt.items.length > 0 || pending.length > 0;
  if (!quiet.value && !pixelsInView && now - lastEvent >= QUIET_AFTER_MS) quiet.value = true;
  // A message goes on the belt once it has been drawn and measured, in the order of arrival
  while (pending.length > 0) {
    const width = elements.get(pending[0].id)?.offsetWidth ?? 0;
    if (width === 0) break;
    const message = pending.shift()!;
    belt = addItem(belt, { id: message.id, width }, stripWidth, true);
  }

  const widths = new Map(
    belt.items.map((item) => [item.id, elements.get(item.id)?.offsetWidth || item.width])
  );
  belt = step(belt, dt, widths);
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
  <section ref="stripEl" class="ticker">
    <ul>
      <li
        v-for="message in drawn"
        :key="message.id"
        :ref="(el) => remember(message.id, el)"
        :style="{ transform: `translateX(${message.left}px)` }"
      >
        <!-- A new key for every count plays the flash again -->
        <span :key="message.count" class="count" :class="{ grew: message.count > 1 }">
          {{ texts.newPixels(message.count) }}
        </span>
        <span class="dot" :style="{ background: message.color, borderColor: message.dot }"></span>
      </li>
    </ul>
    <Transition name="quiet">
      <p v-if="quiet" class="quiet">{{ texts.quiet }}</p>
    </Transition>
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
  /* Digits of one width, so a count does not jump when it grows */
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

/* Over the belt, at the left edge: pixels fade out behind its soft edge */
.quiet {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  height: 100%;
  margin: 0;
  padding: 0 48px 0 16px;
  white-space: nowrap;
  background: linear-gradient(to right, var(--ink) calc(100% - 32px), transparent);
}

/* Out from the left edge at an easy pace; away quickly when a new pixel comes */
.quiet-enter-active {
  transition: transform 400ms ease-out;
}

.quiet-leave-active {
  transition: transform 180ms ease-in;
}

.quiet-enter-from,
.quiet-leave-to {
  transform: translateX(-100%);
}

/* A count that has just grown lights up for a moment. Only transform and colour: the width the
   belt measures stays as it is */
.count {
  display: inline-block;
}

.count.grew {
  animation: grew 600ms ease-out;
}

@keyframes grew {
  from {
    transform: scale(1.35);
    color: #ffffff;
  }

  to {
    transform: none;
  }
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
