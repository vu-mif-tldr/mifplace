import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// The backend serves /api, so in dev the requests go to it.
const BACKEND_URL = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: { '/api': BACKEND_URL },
  },
  test: {
    environment: 'node',
  },
});
