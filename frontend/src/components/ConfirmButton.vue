<script setup lang="ts">
// The button that places the pixel: a wide white button with the label and an arrow. Dimmed
// while there is nothing to place.
defineProps<{ label: string; disabled: boolean }>();
defineEmits<{ press: [] }>();
</script>

<template>
  <button type="button" class="confirm" :disabled="disabled" @click="$emit('press')">
    {{ label }}
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  </button>
</template>

<style scoped>
.confirm {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 58px;
  padding: 0 20px;
  border: 0;
  border-radius: 18px;
  background: #ffffff;
  color: var(--stage);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 8px 22px rgb(0 0 0 / 20%);
  transition:
    transform 0.12s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}

.confirm:hover:not(:disabled) {
  box-shadow: 0 12px 30px rgb(0 0 0 / 30%);
}

.confirm:active:not(:disabled) {
  transform: scale(0.98);
}

.confirm:disabled {
  cursor: default;
  background: rgb(255 255 255 / 16%);
  color: rgb(255 255 255 / 75%);
  box-shadow: none;
}

@media (max-width: 720px) {
  .confirm {
    height: 54px;
  }
}
</style>
