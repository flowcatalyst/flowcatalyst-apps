/**
 * Cross-cutting authorization integration test. Verifies that the
 * `authorize(scope)` check actually rejects when the scope's
 * permission set is missing the required permission — the
 * compile-time wiring works only if the runtime path also denies.
 *
 * One representative use case is enough; the check is symmetric
 * across all 22 (they all read `scope.permissions.has(THIS.requiredPermission)`).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Result } from 'effect';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';

describe('authorize(scope) gating (integration)', () => {
  let appContext: AppContext;

  beforeAll(async () => {
    await getDbFixture();
    appContext = await getTestAppContext();
  });

  beforeEach(async () => {
    await cleanDb();
  });

  it('rejects with AuthorizationError when the scope lacks the required permission', async () => {
    const result = await runInScope(
      // empty permission set — overrides the default ALL_PERMISSIONS
      { sub: 'prn_test_principal', permissions: new Set() },
      () =>
        appContext.runWrite(
          appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          undefined as any,
        ),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) return;
    expect(result.failure._tag).toBe('AuthorizationError');
  });

  it('accepts when the scope carries the required permission', async () => {
    const result = await runInScope(
      {
        sub: 'prn_test_principal',
        permissions: new Set(['pinpoint:tenancy:client:create']),
      },
      () =>
        appContext.runWrite(
          appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          undefined as any,
        ),
    );

    expect(Result.isSuccess(result)).toBe(true);
  });
});
