<script setup lang="ts">
import type { PaletteColor } from '@mifplace/shared';
import { colorName, texts } from '../texts';
import ConfirmButton from './ConfirmButton.vue';

// The dock under the canvas: a hint (or the error of the last pixel), the palette and the
// button that places the pixel
defineProps<{
  palette: PaletteColor[];
  selectedId: number | undefined;
  hint: string;
  error: string;
  placeLabel: string;
  canPlace: boolean;
}>();

defineEmits<{ select: [color: PaletteColor]; place: [] }>();
</script>

<template>
  <footer class="dock">
    <p v-if="error" class="message error" role="alert">{{ error }}</p>
    <p v-else class="message" aria-live="polite">{{ hint }}</p>
    <div class="bar">
      <div class="palette" role="radiogroup" :aria-label="texts.palette">
        <button
          v-for="swatch in palette"
          :key="swatch.id"
          type="button"
          role="radio"
          class="swatch"
          :class="{ selected: swatch.id === selectedId }"
          :aria-checked="swatch.id === selectedId"
          :aria-label="colorName(swatch.color)"
          :title="colorName(swatch.color)"
          :style="{ backgroundColor: swatch.color }"
          @click="$emit('select', swatch)"
        ></button>
      </div>
      <ConfirmButton :label="placeLabel" :disabled="!canPlace" @press="$emit('place')" />
    </div>
  </footer>
</template>

<style scoped>
.dock {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 12px 16px 24px;
}

.message {
  margin: 0;
  min-height: 1.4em;
  font-size: 14px;
  text-align: center;
  color: var(--muted);
}

.error {
  padding: 8px 14px;
  border-radius: 12px;
  color: #ffffff;
  background: rgb(255 138 138 / 14%);
  box-shadow: inset 0 0 0 1px rgb(255 138 138 / 40%);
}

.bar {
  display: flex;
  align-items: center;
  gap: 18px;
  max-width: 100%;
  box-sizing: border-box;
  padding: 12px 12px 12px 22px;
  border-radius: 48px;
  background: rgb(12 16 48 / 82%);
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 10%),
    0 20px 50px rgb(0 0 0 / 35%);
}

.palette {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.swatch {
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 22%);
  transition: transform 0.2s ease;
}

/* Two rings, dark then white, so the selection shows on a white and on a black swatch */
.swatch.selected {
  transform: scale(1.18);
  box-shadow:
    0 0 0 3px var(--ink),
    0 0 0 5px #ffffff;
}

/* Phones: the palette in two rows of large swatches, the button a wide pill under it */
@media (max-width: 720px) {
  .dock {
    padding: 8px 8px 16px;
  }

  .bar {
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
    width: 100%;
    padding: 16px 14px 14px;
    border-radius: 28px;
  }

  .palette {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    justify-items: center;
    gap: 6px;
  }

  .swatch {
    width: 40px;
    height: 40px;
  }
}
</style>
