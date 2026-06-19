import { defineConfig } from 'vitest/config';

/**
 * Integration tests live under `test/integration/` and need Docker running
 * — they boot a PostGIS testcontainer (see `test/integration/db-fixture.ts`).
 * Slow (container boot ~5–15s), so kept separate from the unit suite that
 * `pnpm test` runs.
 *
 * Run with `pnpm test:integration`. CI should run both.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    // Container boot can take ~15s on a cold machine. Default hookTimeout
    // is 10s; bump to 60s so bootstrap doesn't get killed mid-pull.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // The container is shared across all tests. Running suites in
    // parallel would compete for the same DB — keep it single-threaded.
    fileParallelism: false,
    pool: 'forks',
    globalSetup: ['./test/integration/global-setup.ts'],
  },
});
