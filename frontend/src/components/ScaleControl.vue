<script setup lang="ts">
import { SCALE_MAX, SCALE_MIN } from '../canvas';

const scale = defineModel<number>({ required: true });
</script>

<template>
  <label>
    Scale
    <input v-model.number="scale" type="range" :min="SCALE_MIN" :max="SCALE_MAX" step="1" />
  </label>
</template>
