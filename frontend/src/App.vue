<script setup lang="ts">
import { ref } from 'vue';

const color = ref('#000000');
</script>

<template>
  <p>Hello world!</p>
  <input v-model="color" type="color" />
</template>
