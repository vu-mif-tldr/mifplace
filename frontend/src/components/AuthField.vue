<script setup lang="ts">
// One labelled input of the account forms: an email address or a password
const value = defineModel<string>({ required: true });
defineProps<{
  label: string;
  type: 'email' | 'password';
  // What the browser and password managers may fill in: username, current-password, new-password
  autocomplete: string;
  placeholder?: string;
  // Shown under the input; an error replaces the hint
  hint?: string;
  error?: string;
}>();
</script>

<template>
  <label class="field" :class="{ invalid: error }">
    <span class="label">{{ label }}</span>
    <span class="box">
      <input
        v-model="value"
        :type="type"
        :autocomplete="autocomplete"
        :placeholder="placeholder"
        autocapitalize="none"
        spellcheck="false"
      />
    </span>
    <span v-if="error" class="error">{{ error }}</span>
    <span v-else-if="hint" class="hint">{{ hint }}</span>
  </label>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  font-size: 14px;
  color: var(--muted);
}

/* The frame of the input */
.box {
  display: flex;
  align-items: center;
  height: 52px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 14px;
  background: rgb(255 255 255 / 6%);
}

.box:focus-within {
  border-color: #ffffff;
  background: rgb(255 255 255 / 10%);
}

.invalid .box {
  border-color: var(--error);
}

input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 16px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: var(--text);
  /* 16px: iOS zooms the page into anything smaller */
  font: inherit;
  font-size: 16px;
  outline: none;
}

input::placeholder {
  color: rgb(255 255 255 / 32%);
}

.hint,
.error {
  font-size: 13px;
  line-height: 1.4;
}

.hint {
  color: var(--muted);
}

.error {
  color: var(--error);
}
</style>
