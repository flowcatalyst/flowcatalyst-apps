/**
 * Integration test for CreatePartitionUseCase. Covers happy path +
 * client-not-found + duplicate-code-within-client.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { isFailure, isSuccess } from '@pinpoint/framework';

describe('CreatePartitionUseCase (integration)', () => {
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

  async function createClient(): Promise<string> {
    const r = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
      ),
    );
    if (!isSuccess(r)) throw new Error('setup failed');
    return r.value.getData().clientId;
  }

  it('persists a partition + emits PartitionCreated', async () => {
    const clientId = await createClient();

    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createPartition.execute({
          clientId,
          code: 'EU',
          name: 'Europe',
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;

    const partitionId = result.value.getData().partitionId;
    expect(partitionId).toMatch(/^par_/);

    const partition = await appContext.repositories.partitions.findById(partitionId as never);
    expect(partition?.code).toBe('EU');
    expect(partition?.clientId).toBe(clientId);

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:tenancy:partition:created'
    `);
    expect(events.length).toBe(1);
  });

  it('404s when the parent client does not exist', async () => {
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createPartition.execute({
          clientId: 'cli_NOPE',
          code: 'EU',
          name: 'Europe',
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('not_found');
  });

  it('409s a duplicate code within the same client', async () => {
    const clientId = await createClient();

    await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createPartition.execute({
          clientId,
          code: 'EU',
          name: 'Europe',
        }),
      ),
    );

    const second = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>

        appContext.useCases.createPartition.execute({
          clientId,
          code: 'EU',
          name: 'Europe (also)',
        }),
      ),
    );
    expect(isFailure(second)).toBe(true);
    if (!isFailure(second)) return;
    expect(second.error.type).toBe('business_rule');
  });
});
