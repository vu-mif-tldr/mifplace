<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { fetchCanvas, fetchJson, type CanvasSnapshot, type Color } from './api';
import { fitScale, SCALE_MIN } from './canvas';
import { reconnectDelay } from './live';
import CanvasBoard from './components/CanvasBoard.vue';
import ScaleControl from './components/ScaleControl.vue';

// Shallow refs: the snapshot holds a byte per cell, no need to make it reactive.
const palette = shallowRef<Color[]>([]);
const snapshot = shallowRef<CanvasSnapshot | null>(null);
const scale = ref(SCALE_MIN);
const status = ref('');
const controls = ref<HTMLDivElement | null>(null);
// Changes on every reload, so CanvasBoard starts over with the new snapshot.
const loadCount = ref(0);

// The server could not catch the canvas up (too far behind, or the database changed).
// Keeps trying until the canvas loads; the old canvas stays visible meanwhile.
async function reloadCanvas(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      snapshot.value = await fetchCanvas();
      loadCount.value++;
      return;
    } catch (e) {
      console.error(e);
      status.value = 'Could not reload the canvas, trying again…';
      await new Promise((resolve) => setTimeout(resolve, reconnectDelay(attempt)));
    }
  }
}

onMounted(async () => {
  try {
    const [loadedPalette, loadedSnapshot] = await Promise.all([
      fetchJson<Color[]>('/api/palette'),
      fetchCanvas(),
    ]);
    // At first the canvas fits the window completely; the controls above it take their height.
    scale.value = fitScale(
      loadedSnapshot.width,
      loadedSnapshot.height,
      document.documentElement.clientWidth,
      document.documentElement.clientHeight - (controls.value?.offsetHeight ?? 0)
    );
    palette.value = loadedPalette;
    snapshot.value = loadedSnapshot;
  } catch (e) {
    console.error(e);
    status.value = 'Could not load the canvas.';
  }
});
</script>

<template>
  <div id="page">
    <div id="controls" ref="controls">
      <ScaleControl v-model="scale" />
      <p id="status" role="status">{{ status }}</p>
    </div>
    <div id="stage">
      <CanvasBoard
        v-if="snapshot"
        :key="loadCount"
        :palette="palette"
        :snapshot="snapshot"
        :scale="scale"
        @status="status = $event"
        @reload="reloadCanvas"
      />
    </div>
  </div>
</template>
