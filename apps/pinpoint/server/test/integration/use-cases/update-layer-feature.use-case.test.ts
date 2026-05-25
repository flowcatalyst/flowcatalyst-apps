/**
 * Integration test for UpdateLayerFeatureUseCase. Verifies field-level
 * update + LayerFeatureUpdated; 404 on missing.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { isFailure, isSuccess } from '@pinpoint/framework';

describe('UpdateLayerFeatureUseCase (integration)', () => {
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

  async function seedFeature(): Promise<{ featureId: string }> {
    const c = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
      ),
    );
    if (!isSuccess(c)) throw new Error('client setup failed');
    const clientId = c.value.getData().clientId;

    const l = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createLayer.execute({
          clientId,
          code: 'stores',
          name: 'Stores',
          layerType: 'RADIUS',
          centerLat: -26.2,
          centerLon: 28.05,
          radiusMeters: 5000,
        }),
      ),
    );
    if (!isSuccess(l)) throw new Error('layer setup failed');
    const layerId = l.value.getData().layerId;

    const f = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createLayerFeature.execute({
          layerId,
          label: 'Sandton',
          centerLat: -26.1075,
          centerLon: 28.0567,
          radiusMeters: 1500,
          propertyValues: { format: 'flagship' },
        }),
      ),
    );
    if (!isSuccess(f)) throw new Error('feature setup failed');
    return { featureId: f.value.getData().featureId };
  }

  it('updates label + propertyValues + emits LayerFeatureUpdated', async () => {
    const { featureId } = await seedFeature();

    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.updateLayerFeature.execute({
          featureId,
          label: 'Sandton City',
          centerLat: -26.1075,
          centerLon: 28.0567,
          radiusMeters: 2000,
          propertyValues: { format: 'flagship', tier: 'gold' },
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);

    const feature = await appContext.repositories.layerFeatures.findById(featureId as never);
    expect(feature?.label).toBe('Sandton City');
    expect(feature?.radiusMeters).toBe(2000);
    expect(feature?.propertyValues).toMatchObject({ format: 'flagship', tier: 'gold' });

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:layers:feature:updated'
    `);
    expect(events.length).toBe(1);
  });

  it('404s on a missing feature', async () => {
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.updateLayerFeature.execute({
          featureId: 'lfe_NOPE',
          label: 'X',
          centerLat: 0,
          centerLon: 0,
          radiusMeters: 100,
          propertyValues: {},
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('not_found');
  });
});
