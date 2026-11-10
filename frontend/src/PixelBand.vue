<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Band, DEFAULT_BAND_COLOR, buildRamp, mixColors, planeTransform } from './pixelBand';

const props = defineProps<{ color?: string }>();

const MIN_FRAME_INTERVAL = 1000 / 30; // ms, the band is slow and does not need more
const COLOR_TRANSITION = 1500; // ms

const canvasEl = ref<HTMLCanvasElement | null>(null);

let frameRequest = 0;
let lastFrame = 0;
const band = new Band();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const resizeObserver = new window.ResizeObserver(() => draw());

// The band goes smoothly from the color it shows at the moment of a change to the new one
let shownColor = props.color ?? DEFAULT_BAND_COLOR;
let fromColor = shownColor;
let transitionStart = -COLOR_TRANSITION;

function updateShownColor() {
  const elapsed = window.performance.now() - transitionStart;
  const target = props.color ?? DEFAULT_BAND_COLOR;
  shownColor = mixColors(fromColor, target, Math.min(1, elapsed / COLOR_TRANSITION));
}

watch(
  () => props.color,
  () => {
    fromColor = shownColor;
    transitionStart = window.performance.now();
    // With a new color the band goes a new way, any from 0 to 359 degrees
    band.turnTo((Math.floor(Math.random() * 360) * Math.PI) / 180);
    // A still band has no frames to show the transition with
    if (reducedMotion.matches) {
      transitionStart = -COLOR_TRANSITION;
      draw();
    }
  }
);

function draw() {
  const canvas = canvasEl.value;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;

  const ratio = window.devicePixelRatio;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.transform(...planeTransform(width, height));
  updateShownColor();
  const ramp = buildRamp(shownColor);
  for (const rect of band.rects(width, height, ramp)) {
    ctx.fillStyle = rect.color;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
}

function onFrame(now: number) {
  frameRequest = window.requestAnimationFrame(onFrame);
  if (now - lastFrame < MIN_FRAME_INTERVAL) return;
  // The first frame after a start only draws
  if (lastFrame > 0) band.advance((now - lastFrame) / 1000);
  lastFrame = now;
  draw();
}

// With reduced motion the band is a still picture, redrawn only when its size or color changes
function restart() {
  window.cancelAnimationFrame(frameRequest);
  lastFrame = 0;
  if (reducedMotion.matches) draw();
  else frameRequest = window.requestAnimationFrame(onFrame);
}

onMounted(() => {
  if (canvasEl.value) resizeObserver.observe(canvasEl.value);
  reducedMotion.addEventListener('change', restart);
  restart();
});

onBeforeUnmount(() => {
  window.cancelAnimationFrame(frameRequest);
  resizeObserver.disconnect();
  reducedMotion.removeEventListener('change', restart);
});
</script>

<template>
  <canvas ref="canvasEl" class="pixel-band" aria-hidden="true"></canvas>
</template>
