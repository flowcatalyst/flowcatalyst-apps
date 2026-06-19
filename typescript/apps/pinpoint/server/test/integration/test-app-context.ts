/**
 * Build a real AppContext wired to the testcontainer DB, for use-case
 * integration tests. Mirrors `server.ts`'s `createAppContext` call but
 * with deterministic / cred-free service defaults:
 *
 *   - Geocoder: still Photon-shaped but never actually invoked here
 *     (the use cases that hit it skip via the matching pipeline's
 *     existing branches).
 *   - LLM verifier: `none` (Noop) — keeps creation cred-free.
 *   - libpostal: a fake URL — only invoked by create-location, and
 *     those tests inject their own normalized input via the command.
 *     If a future use-case test needs libpostal, mock the fetch.
 *   - OIDC: unset → auth surface stays inert, dev fallback off; the
 *     tests bind their own ScopeStore via `runInScope` below.
 */
import { ScopeStore, Scope, type RequestToken } from '@pinpoint/framework';
import { createAppContext, type AppContext } from '../../src/app-context.js';
import { ALL_PERMISSIONS_SET } from '../../src/auth/role-permissions.js';
import { getDbFixture } from './db-fixture.js';

let appContextPromise: Promise<AppContext> | null = null;

export async function getTestAppContext(): Promise<AppContext> {
  if (!appContextPromise) {
    appContextPromise = (async () => {
      const { db } = await getDbFixture();
      return createAppContext({
        db,
        clientId: 'test',
        publicBaseUrl: 'http://localhost:3000',
        dispatchPoolCode: 'test-pool',
        geocodingApiUrl: 'http://geocoder.invalid',
        geocodingRateLimit: 5,
        addressVerifier: { provider: 'none' },
        libpostalUrl: 'http://libpostal.invalid',
        auth: {
          oidc: null,
          devFallback: false,
          postLoginRedirect: '/',
          session: { driver: 'memory', redisUrl: null },
        },
      });
    })();
  }
  return appContextPromise;
}

/**
 * Run a function inside a fresh ScopeStore. Tests need this because
 * commitAggregate calls `ScopeStore.require()` to read the principal id
 * for the audit-log row; without a bound scope every use case errors
 * before touching the DB.
 *
 * Grants the full permission set by default — matches the dev-fallback
 * auth behaviour in `server.ts` so the use-case `authorize(scope)`
 * checks always pass in tests. Pass an explicit `permissions` on the
 * token to scope down (e.g. for a permission-denied test case).
 */
export function runInScope<T>(token: RequestToken, fn: () => T | Promise<T>): Promise<T> {
  const scope = Scope.fromRequest({
    ...token,
    permissions: token.permissions ?? ALL_PERMISSIONS_SET,
  });
  return new Promise((resolve, reject) => {
    ScopeStore.run(scope, () => {
      Promise.resolve(fn()).then(resolve, reject);
    });
  });
}
