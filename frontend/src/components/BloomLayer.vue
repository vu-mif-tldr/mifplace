<script setup lang="ts">
import { computed } from 'vue';
import { BLOOM_EFFECTS, type Bloom, type BloomEffects } from '../blooms';
import { outlineFor } from '../glow';
import { cellCenter, type Cell } from '../view';

// The flashes where pixels have just arrived (MP-117), over the canvas in viewport px.
// Each bloom is up to two kinds of CSS animation (glow, rings), switched on and tuned by
// `effects`; the list itself is kept by useBlooms.
const props = withDefaults(
  defineProps<{ blooms: Bloom[]; offset: Cell; cellPx: number; effects?: BloomEffects }>(),
  { effects: () => BLOOM_EFFECTS }
);

const px = (value: number) => `${value}px`;
const ms = (value: number) => `${value}ms`;

type Part = { key: string; kind: 'bloom' | 'ring'; style: Record<string, string> };

const parts = computed(() => {
  const { glow, ring } = props.effects;
  const cell = props.cellPx;
  const glowSize = Math.max(glow.minPx, cell * glow.sizeCells);
  const ringSize = Math.max(ring.minPx, cell * ring.sizeCells);

  const result: Part[] = [];
  for (const bloom of props.blooms) {
    const center = cellCenter(bloom, props.offset, cell);
    const at = { left: px(center.x), top: px(center.y), '--bloom': bloom.color };
    const edge = outlineFor(bloom.color);

    if (glow.enabled) {
      result.push({
        key: `${bloom.id}-glow`,
        kind: 'bloom',
        style: {
          ...at,
          width: px(glowSize),
          height: px(glowSize),
          '--ms': ms(glow.ms),
          '--peak': String(glow.peakScale),
          '--opacity': String(glow.opacity),
        },
      });
    }

    if (ring.enabled) {
      for (let wave = 0; wave < ring.waves; wave++) {
        result.push({
          key: `${bloom.id}-ring-${wave}`,
          kind: 'ring',
          style: {
            ...at,
            '--edge': edge,
            '--ms': ms(ring.ms),
            '--delay': ms(wave * ring.gapMs),
            '--from': px(cell + 2 * ring.widthPx),
            '--to': px(ringSize),
            '--width': px(ring.widthPx),
            '--edge-width': px(ring.edgePx),
          },
        });
      }
    }
  }
  return result;
});
</script>

<template>
  <span v-for="part in parts" :key="part.key" :class="part.kind" :style="part.style"></span>
</template>

<style scoped>
.bloom,
.ring {
  position: absolute;
  box-sizing: border-box;
  transform: translate(-50%, -50%);
}

/* Glow: up fast to --peak at full --opacity, a short bright moment, then out while fading */
.bloom {
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--bloom) 90%, transparent),
    transparent 70%
  );
  opacity: 0;
  animation: bloom-glow var(--ms) ease-out forwards;
}

@keyframes bloom-glow {
  0% {
    scale: 0.15;
    opacity: var(--opacity);
  }
  18% {
    scale: var(--peak);
    opacity: var(--opacity);
  }
  35% {
    scale: calc(var(--peak) + 0.08);
    opacity: var(--opacity);
  }
  100% {
    scale: 1;
    opacity: 0;
  }
}

/* Ring: a sharp line in the colour with a thin contrast edge on both sides, running out from
   the cell. Width and height grow, not scale, so the line stays as thick as --width. */
.ring {
  border-radius: 50%;
  border: var(--width) solid var(--bloom);
  box-shadow:
    0 0 0 var(--edge-width) var(--edge),
    inset 0 0 0 var(--edge-width) var(--edge);
  width: var(--from);
  height: var(--from);
  opacity: 0;
  animation: bloom-ring var(--ms) cubic-bezier(0.2, 0.7, 0.3, 1) var(--delay) forwards;
}

@keyframes bloom-ring {
  0% {
    width: var(--from);
    height: var(--from);
    opacity: 1;
  }
  60% {
    opacity: 0.8;
  }
  100% {
    width: var(--to);
    height: var(--to);
    opacity: 0;
  }
}
</style>
