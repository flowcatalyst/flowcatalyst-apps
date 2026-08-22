import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { isFailure, isSuccess } from '@pinpoint/framework';
import { asLayerId } from '../../../src/domain/layers/ids.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { seedClient, seedLayerWithRadiusFeature } from './_operator-seeds.js';

describe('SetLayerPartitionsUseCase (integration)', () => {
  let appContext: AppContext;
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];
  beforeAll(async () => {
    db = (await getDbFixture()).db;
    appContext = await getTestAppContext();
  });
  beforeEach(async () => {
    await cleanDb();
  });

  it('replaces the partition set and emits layers:layer:partitions-set', async () => {
    const { clientId, defaultPartitionId } = await seedClient(appContext);
    const { layerId } = await seedLayerWithRadiusFeature(appContext, clientId, { lat: 0, lon: 0 });
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.setLayerPartitions.execute({
          clientId,
          layerId,
          partitionIds: [defaultPartitionId],
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);
    expect(await appContext.repositories.layers.findPartitionIds(asLayerId(layerId))).toEqual([
      defaultPartitionId,
    ]);
    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE payload::jsonb->>'type' = 'pinpoint:layers:layer:partitions-set'
    `);
    expect(events.length).toBe(1);

    // Empty set = visible to all partitions again.
    const cleared = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.setLayerPartitions.execute({ clientId, layerId, partitionIds: [] }),
      ),
    );
    expect(isSuccess(cleared)).toBe(true);
    expect(await appContext.repositories.layers.findPartitionIds(asLayerId(layerId))).toEqual([]);
  });

  it('rejects a partition from another client', async () => {
    const a = await seedClient(appContext);
    const b = await seedClient(appContext);
    const { layerId } = await seedLayerWithRadiusFeature(appContext, a.clientId, {
      lat: 0,
      lon: 0,
    });
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.setLayerPartitions.execute({
          clientId: a.clientId,
          layerId,
          partitionIds: [b.defaultPartitionId],
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) expect(result.error.code).toBe('PARTITION_NOT_IN_CLIENT');
  });
});
