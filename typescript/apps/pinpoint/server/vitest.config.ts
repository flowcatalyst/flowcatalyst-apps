import { defineConfig } from 'vitest/config';

/**
 * Unit-test config. Integration tests live under `test/integration/` and
 * have their own config (`vitest.integration.config.ts`) because they
 * spin up a Docker container per run. `pnpm test` runs these; `pnpm
 * test:integration` runs the slow ones; `pnpm test:all` runs both.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    exclude: ['**/node_modules/**', 'test/integration/**'],
  },
});
