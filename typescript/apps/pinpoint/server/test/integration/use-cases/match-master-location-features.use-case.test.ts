import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { isFailure, isSuccess } from '@pinpoint/framework';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import {
  seedClient,
  seedGeocodedMasterWithChild,
  seedLayerWithRadiusFeature,
} from './_operator-seeds.js';

describe('MatchMasterLocationFeaturesUseCase (integration)', () => {
  let appContext: AppContext;
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];
  beforeAll(async () => {
    db = (await getDbFixture()).db;
    appContext = await getTestAppContext();
  });
  beforeEach(async () => {
    await cleanDb();
  });

  it('associates every child location with the containing features and emits features-matched', async () => {
    const { clientId, defaultPartitionId } = await seedClient(appContext);
    const point = { lat: -33.92, lon: 18.42 };
    const { featureId } = await seedLayerWithRadiusFeature(appContext, clientId, point);
    const { masterLocationId, locationId } = await seedGeocodedMasterWithChild(
      appContext,
      clientId,
      defaultPartitionId,
      point,
    );

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.matchMasterLocationFeatures.execute({ clientId, masterLocationId }),
      ),
    );
    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;
    const data = result.value.getData();
    expect(data.locationsUpdated).toBe(1);
    expect(data.features.map((f) => f.layerFeatureId)).toEqual([featureId]);

    const assoc = await appContext.repositories.layerFeatures.findFeatureAssociations(locationId);
    expect(assoc.map((a) => a.layerFeatureId)).toEqual([featureId]);
    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE payload::jsonb->>'type' = 'pinpoint:locations:master_location:features-matched'
    `);
    expect(events.length).toBe(1);
  });

  it('fails with NO_COORDINATES for a master that was never geocoded', async () => {
    const { clientId, defaultPartitionId } = await seedClient(appContext);
    const { masterLocationId } = await seedGeocodedMasterWithChild(
      appContext,
      clientId,
      defaultPartitionId,
      { lat: 0, lon: 0 },
    );
    // strip the coords again
    const m = await appContext.repositories.masterLocations.findById(masterLocationId as never);
    await appContext.repositories.masterLocations.persist({
      ...m!,
      latitude: null,
      longitude: null,
      status: 'PENDING',
    });
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.matchMasterLocationFeatures.execute({ clientId, masterLocationId }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) expect(result.error.code).toBe('NO_COORDINATES');
  });
});
