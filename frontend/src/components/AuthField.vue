<script setup lang="ts">
import { ref } from 'vue';
import { authTexts } from '../texts';

// One labelled input of the account forms: an email address or a password. A password can be
// shown while typing, so the forms need no "repeat the password" field.
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

const shown = ref(false);
</script>

<template>
  <label class="field" :class="{ invalid: error }">
    <span class="label">{{ label }}</span>
    <span class="box">
      <input
        v-model="value"
        :type="type === 'password' && shown ? 'text' : type"
        :autocomplete="autocomplete"
        :placeholder="placeholder"
        autocapitalize="none"
        spellcheck="false"
      />
      <button v-if="type === 'password'" type="button" class="reveal" @click="shown = !shown">
        {{ shown ? authTexts.hide : authTexts.show }}
      </button>
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

/* The input and the "show" button share one frame */
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

.reveal {
  flex: none;
  height: 36px;
  margin-right: 8px;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
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
