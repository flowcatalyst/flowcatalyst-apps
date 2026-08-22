import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { isFailure, isSuccess } from '@pinpoint/framework';
import { asPrincipalId } from '../../../src/domain/auth/ids.js';
import { asPartitionId } from '../../../src/domain/tenancy/ids.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { seedClient } from './_operator-seeds.js';

describe('Grant/RevokePartitionAccessUseCase (integration)', () => {
  let appContext: AppContext;
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];
  beforeAll(async () => {
    db = (await getDbFixture()).db;
    appContext = await getTestAppContext();
  });
  beforeEach(async () => {
    await cleanDb();
  });

  it('grants then revokes access, emitting one event each', async () => {
    const { clientId, defaultPartitionId } = await seedClient(appContext);
    await appContext.repositories.principals.upsert({
      id: asPrincipalId('prn_admin'),
      principalType: 'USER',
      name: 'Admin',
    });
    const principal = await appContext.repositories.principals.upsert({
      id: asPrincipalId('prn_bob'),
      principalType: 'USER',
      name: 'Bob',
      email: 'bob@example.test',
    });

    const grant = await runInScope({ sub: 'prn_admin' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.grantPartitionAccess.execute({
          clientId,
          partitionId: defaultPartitionId,
          principalId: principal.id,
        }),
      ),
    );
    expect(isSuccess(grant)).toBe(true);
    if (isSuccess(grant)) expect(grant.value.getData().grantedBy).toBe('prn_admin');
    const granted = await appContext.repositories.principals.findPrincipalsForPartition(
      asPartitionId(defaultPartitionId),
    );
    expect(granted.map((g) => g.principal.id)).toContain('prn_bob');

    const revoke = await runInScope({ sub: 'prn_admin' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.revokePartitionAccess.execute({
          clientId,
          partitionId: defaultPartitionId,
          principalId: principal.id,
        }),
      ),
    );
    expect(isSuccess(revoke)).toBe(true);
    const after = await appContext.repositories.principals.findPrincipalsForPartition(
      asPartitionId(defaultPartitionId),
    );
    expect(after.map((g) => g.principal.id)).not.toContain('prn_bob');

    const events = await db.execute(sql`
      SELECT payload::jsonb->>'type' AS type FROM outbox_messages
      WHERE payload::jsonb->>'type' IN ('pinpoint:tenancy:partition:access-granted','pinpoint:tenancy:partition:access-revoked')
      ORDER BY 1
    `);
    expect(events.map((r) => r['type'])).toEqual([
      'pinpoint:tenancy:partition:access-granted',
      'pinpoint:tenancy:partition:access-revoked',
    ]);

    // Revoking again is not_found — there is no grant left to remove.
    const again = await runInScope({ sub: 'prn_admin' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.revokePartitionAccess.execute({
          clientId,
          partitionId: defaultPartitionId,
          principalId: principal.id,
        }),
      ),
    );
    expect(isFailure(again)).toBe(true);
    if (isFailure(again)) expect(again.error.code).toBe('PARTITION_ACCESS_NOT_FOUND');
  });

  it('refuses to grant an unknown principal', async () => {
    const { clientId, defaultPartitionId } = await seedClient(appContext);
    const result = await runInScope({ sub: 'prn_admin' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.grantPartitionAccess.execute({
          clientId,
          partitionId: defaultPartitionId,
          principalId: 'prn_ghost',
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) expect(result.error.code).toBe('PRINCIPAL_NOT_FOUND');
  });
});
