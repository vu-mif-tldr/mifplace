<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { fetchCanvas, fetchJson, type CanvasSnapshot, type Color } from './api';
import { fitScale, SCALE_MIN } from './canvas';
import CanvasBoard from './components/CanvasBoard.vue';
import ScaleControl from './components/ScaleControl.vue';

// Shallow refs: the snapshot holds a byte per cell, no need to make it reactive.
const palette = shallowRef<Color[]>([]);
const snapshot = shallowRef<CanvasSnapshot | null>(null);
const scale = ref(SCALE_MIN);
const status = ref('');
const controls = ref<HTMLDivElement | null>(null);

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
        :palette="palette"
        :snapshot="snapshot"
        :scale="scale"
        @status="status = $event"
      />
    </div>
  </div>
</template>
