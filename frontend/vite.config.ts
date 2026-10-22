import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  server: {
    // Forward /api requests to the backend to avoid CORS errors
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
