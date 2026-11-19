<script setup lang="ts">
import type { PaletteColor } from '@mifplace/shared';
import { readableOn } from '../glow';
import { colorName } from '../texts';
import ConfirmButton from './ConfirmButton.vue';

// The bar under the canvas, kept small so the canvas is the main thing on the page: a hint (or
// the error of the last pixel), the progress bar of the cooldown, then the palette in one row
// with the button that places the pixel. On a narrow screen the palette wraps into two rows and
// the button goes under it.
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
    <section class="card">
      <div class="status">
        <span class="dot" :class="{ ready: canPlace }"></span>
        <p v-if="error" class="message error">{{ error }}</p>
        <p v-else class="message">{{ hint }}</p>
      </div>
      <div class="progress"><span class="fill"></span></div>
      <div class="controls">
        <div class="palette">
          <button
            v-for="swatch in palette"
            :key="swatch.id"
            type="button"
            class="swatch"
            :class="{ selected: swatch.id === selectedId }"
            :title="colorName(swatch.color)"
            :style="{ backgroundColor: swatch.color }"
            @click="$emit('select', swatch)"
          >
            <svg
              v-if="swatch.id === selectedId"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              :stroke="readableOn(swatch.color)"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </button>
        </div>
        <ConfirmButton
          class="place"
          :label="placeLabel"
          :disabled="!canPlace"
          @press="$emit('place')"
        />
      </div>
    </section>
  </footer>
</template>

<style scoped>
.dock {
  display: flex;
  justify-content: center;
  padding: 14px 16px 16px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 960px;
  box-sizing: border-box;
  padding: 12px 14px 14px;
  border-radius: 20px;
  background: rgb(255 255 255 / 10%);
}

.status {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 20px;
}

.dot {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: #ffffff;
  transition: background-color 0.3s ease;
}

.dot.ready {
  background: var(--ok);
}

.message {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
}

.error {
  padding: 4px 10px;
  border-radius: 8px;
  background: rgb(255 179 192 / 16%);
  box-shadow: inset 0 0 0 1px rgb(255 179 192 / 45%);
}

/* The cooldown (--progress, set by App.vue): full while a pixel may be placed */
.progress {
  height: 3px;
  overflow: hidden;
  border-radius: 2px;
  background: rgb(255 255 255 / 18%);
}

.fill {
  display: block;
  width: var(--progress, 100%);
  height: 100%;
  border-radius: 2px;
  background: var(--ok);
  transition: width 1s linear;
}

.controls {
  display: flex;
  align-items: center;
  gap: 14px;
}

.palette {
  display: flex;
  flex: 1;
  gap: 6px;
  min-width: 0;
}

.swatch {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 42px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 22%);
  transition:
    transform 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.3),
    box-shadow 0.16s ease;
}

.swatch:hover {
  transform: translateY(-2px);
}

.swatch:active {
  transform: scale(0.94);
}

/* Two rings, bordo then white, so the selection shows on a white and on a dark swatch */
.swatch.selected {
  z-index: 1;
  box-shadow:
    0 0 0 3px var(--stage),
    0 0 0 5px #ffffff;
}

.swatch svg {
  width: 18px;
  height: 18px;
}

/* The button beside the palette: as wide as its label */
.controls .place {
  flex: none;
  width: auto;
  height: 46px;
  padding: 0 22px;
  border-radius: 14px;
  font-size: 15px;
}

/* Too narrow for one row: the palette in two rows, the button under it */
@media (max-width: 960px) {
  .controls {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .palette {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 7px;
  }

  .swatch {
    height: 38px;
  }

  .controls .place {
    width: 100%;
    height: 50px;
  }
}

@media (max-width: 720px) {
  .dock {
    padding: 10px 12px 12px;
  }
}
</style>
