/**
 * Integration test for UpdatePartitionUseCase. Renames a partition,
 * verifies outbox event + row update; 404 path.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { isFailure, isSuccess } from '@pinpoint/framework';

describe('UpdatePartitionUseCase (integration)', () => {
  let appContext: AppContext;
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];

  beforeAll(async () => {
    const fixture = await getDbFixture();
    db = fixture.db;
    appContext = await getTestAppContext();
  });

  beforeEach(async () => {
    await cleanDb();
  });

  async function seed(): Promise<{ clientId: string; partitionId: string }> {
    const c = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
      ),
    );
    if (!isSuccess(c)) throw new Error('client setup failed');
    const clientId = c.value.getData().clientId;

    const p = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createPartition.execute({
          clientId,
          code: 'EU',
          name: 'Europe',
        }),
      ),
    );
    if (!isSuccess(p)) throw new Error('partition setup failed');
    return { clientId, partitionId: p.value.getData().partitionId };
  }

  it('renames a partition + emits PartitionUpdated', async () => {
    const { clientId, partitionId } = await seed();

    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.updatePartition.execute({
          clientId,
          partitionId,
          name: 'EMEA',
          description: 'rebranded',
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);

    const partition = await appContext.repositories.partitions.findById(partitionId as never);
    expect(partition?.name).toBe('EMEA');
    expect(partition?.description).toBe('rebranded');

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:tenancy:partition:updated'
    `);
    expect(events.length).toBe(1);
  });

  it('404s on a missing partition', async () => {
    const { clientId } = await seed();
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.updatePartition.execute({
          clientId,
          partitionId: 'par_NOPE',
          name: 'X',
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('not_found');
  });
});
