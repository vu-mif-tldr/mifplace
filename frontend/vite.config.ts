import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  server: {
    // The API runs on the backend dev server; the browser only talks to this origin.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  test: {
    globals: true,
    coverage: {
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
