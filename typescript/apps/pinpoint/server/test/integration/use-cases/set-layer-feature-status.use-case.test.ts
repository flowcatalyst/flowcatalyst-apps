import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { isFailure, isSuccess } from '@pinpoint/framework';
import { asLayerFeatureId } from '../../../src/domain/layers/ids.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { seedClient, seedLayerWithRadiusFeature } from './_operator-seeds.js';

describe('SetLayerFeatureStatusUseCase (integration)', () => {
  let appContext: AppContext;
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];
  beforeAll(async () => {
    db = (await getDbFixture()).db;
    appContext = await getTestAppContext();
  });
  beforeEach(async () => {
    await cleanDb();
  });

  it('deactivates a feature and emits layers:feature:status-changed', async () => {
    const { clientId } = await seedClient(appContext);
    const { layerId, featureId } = await seedLayerWithRadiusFeature(appContext, clientId, {
      lat: -33.92,
      lon: 18.42,
    });
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.setLayerFeatureStatus.execute({
          clientId,
          layerId,
          featureId,
          status: 'INACTIVE',
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);
    const feature = await appContext.repositories.layerFeatures.findById(
      asLayerFeatureId(featureId),
    );
    expect(feature?.status).toBe('INACTIVE');
    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE payload::jsonb->>'type' = 'pinpoint:layers:feature:status-changed'
    `);
    expect(events.length).toBe(1);
  });

  it('rejects a feature from another client with not_found', async () => {
    const a = await seedClient(appContext);
    const b = await seedClient(appContext);
    const { layerId, featureId } = await seedLayerWithRadiusFeature(appContext, a.clientId, {
      lat: 0,
      lon: 0,
    });
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.setLayerFeatureStatus.execute({
          clientId: b.clientId,
          layerId,
          featureId,
          status: 'ACTIVE',
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) expect(result.error.type).toBe('not_found');
  });
});
