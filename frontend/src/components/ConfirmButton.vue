<script setup lang="ts">
// The button that places the pixel. Its rim is the same ring as on the canvas, filled by
// --progress (the cooldown). Round with a check mark on a wide screen, a wide pill with the
// label on a phone.
defineProps<{ label: string; disabled: boolean }>();
defineEmits<{ press: [] }>();
</script>

<template>
  <button type="button" class="confirm" :disabled="disabled" @click="$emit('press')">
    <span class="face">
      <svg width="26" height="26" viewBox="0 0 24 24">
        <path
          d="M5 12.5l4.5 4.5L19 7.5"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span class="text">{{ label }}</span>
    </span>
  </button>
</template>

<style scoped>
.confirm {
  flex: none;
  width: 64px;
  height: 64px;
  padding: 5px;
  border: 0;
  border-radius: 50%;
  background: conic-gradient(var(--glow) var(--progress), rgb(255 255 255 / 18%) 0);
  cursor: pointer;
}

.face {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: #ffffff;
  color: var(--ink);
}

/* On a wide screen the check mark alone */
.text {
  display: none;
}

.confirm:disabled {
  cursor: default;
}

.confirm:disabled .face {
  background: var(--ink);
  color: rgb(255 255 255 / 40%);
}

@media (max-width: 720px) {
  .confirm {
    width: 100%;
    height: 56px;
    padding: 0;
    border-radius: 28px;
    background: #ffffff;
  }

  .face {
    border-radius: 28px;
    background: transparent;
    font-size: 16px;
    font-weight: 600;
  }

  .text {
    display: inline;
  }

  .confirm:disabled {
    background: rgb(255 255 255 / 10%);
  }

  .confirm:disabled .face {
    background: transparent;
  }
}
</style>
