import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // dist/ is compiled output — running its stale .test.js copies alongside
    // src double-counts tests and fails after any src-only change.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
