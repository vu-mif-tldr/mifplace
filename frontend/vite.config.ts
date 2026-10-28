import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  server: {
    // IPv4 explicitly: "localhost" may resolve to ::1 only (e.g. in the dev container),
    // and the port forwarding of VS Code and Codespaces connects to 127.0.0.1
    host: '127.0.0.1',
    // Forward /api requests to the backend to avoid CORS errors
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  test: {
    globals: true,
    // In CI also a JUnit report, uploaded to Codecov Test Analytics (failed and flaky tests)
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'test-results/junit.xml' },
    coverage: {
      // lcov is uploaded to Codecov by CI
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
