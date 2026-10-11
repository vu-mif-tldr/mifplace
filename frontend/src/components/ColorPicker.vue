<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Color } from '../api';

const props = defineProps<{
  palette: Color[];
  chosenId: number | null;
  saving: boolean;
  // Page coordinates of the click that opened the picker.
  anchor: { x: number; y: number };
}>();
const emit = defineEmits<{ pick: [color: Color] }>();

const MARGIN = 8;

const root = ref<HTMLDivElement | null>(null);
const position = ref({ left: props.anchor.x + MARGIN, top: props.anchor.y + MARGIN });

// Next to the click, moved back inside the visible part of the page if it does not fit.
onMounted(() => {
  const el = root.value;
  if (!el) return;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - el.offsetWidth - MARGIN;
  const maxTop = window.scrollY + document.documentElement.clientHeight - el.offsetHeight - MARGIN;
  position.value = {
    left: Math.max(0, Math.min(props.anchor.x + MARGIN, maxLeft)),
    top: Math.max(0, Math.min(props.anchor.y + MARGIN, maxTop)),
  };
});
</script>

<template>
  <!-- .stop: a click inside the picker must not reach the document handler that closes it. -->
  <div
    id="picker"
    ref="root"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    @click.stop
  >
    <div id="swatches">
      <button
        v-for="color in palette"
        :key="color.id"
        type="button"
        class="swatch"
        :style="{ backgroundColor: color.rgb }"
        :title="color.rgb"
        :aria-label="color.rgb"
        :aria-pressed="chosenId === color.id"
        :disabled="saving"
        @click="emit('pick', color)"
      />
    </div>
  </div>
</template>
