/**
 * Vitest globalSetup — boot the testcontainer once for the whole run,
 * tear it down after the last test. Per-test cleanup happens via
 * `cleanDb()` in each test's beforeEach.
 *
 * NOTE: vitest's `globalSetup` runs in an isolated worker that can't
 * share state with the test workers, so we DON'T export the db handle
 * from here — tests call `getDbFixture()` directly. This setup file
 * exists mainly so we get a clean container teardown at the end of the
 * run instead of leaking it.
 *
 * The actual container boot is also handled lazily by `db-fixture.ts`
 * when the first test calls `getDbFixture()`. That's the source of
 * truth; this file just tears down.
 */
import { teardownDbFixture } from './db-fixture.js';

export default function setup(): () => Promise<void> {
  return async () => {
    await teardownDbFixture();
  };
}
