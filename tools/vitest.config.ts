import { defineConfig } from 'vitest/config';

export default defineConfig({
  // @mifplace/db from its TypeScript sources, so the tests do not need a built db/dist.
  // The rest is Vite's default list, which this setting replaces.
  ssr: {
    resolve: { conditions: ['@mifplace/source', 'module', 'node', 'development|production'] },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // In CI also a JUnit report, uploaded to Codecov Test Analytics (failed and flaky tests)
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'test-results/junit.xml' },
    coverage: {
      // lcov is uploaded to Codecov by CI
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
