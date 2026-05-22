/**
 * Integration test for CreateLayerFeatureUseCase. Verifies the row
 * lands, LayerFeatureCreated emits, and the layer-not-found path 404s.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Result } from 'effect';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';

describe('CreateLayerFeatureUseCase (integration)', () => {
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

  async function seedLayer(): Promise<{ clientId: string; layerId: string }> {
    const c = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(c)) throw new Error('client setup failed');
    const clientId = c.success.event.getData().clientId;

    const l = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(
        appContext.useCases.createLayer.execute({
          clientId,
          code: 'stores',
          name: 'Stores',
          layerType: 'RADIUS',
          centerLat: -26.2,
          centerLon: 28.05,
          radiusMeters: 5000,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(l)) throw new Error('layer setup failed');
    return { clientId, layerId: l.success.event.getData().layerId };
  }

  it('creates a feature + emits LayerFeatureCreated', async () => {
    const { layerId } = await seedLayer();

    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(
        appContext.useCases.createLayerFeature.execute({
          layerId,
          label: 'Sandton',
          centerLat: -26.1075,
          centerLon: 28.0567,
          radiusMeters: 1500,
          propertyValues: { format: 'flagship' },
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;

    const featureId = result.success.event.getData().featureId;
    expect(featureId).toMatch(/^lfe_/);

    const feature = await appContext.repositories.layerFeatures.findById(featureId as never);
    expect(feature?.label).toBe('Sandton');
    expect(feature?.propertyValues).toMatchObject({ format: 'flagship' });

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:layers:feature:created'
    `);
    expect(events.length).toBe(1);
  });

  it('404s when the parent layer does not exist', async () => {
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(
        appContext.useCases.createLayerFeature.execute({
          layerId: 'lyr_NOPE',
          label: 'Ghost',
          centerLat: 0,
          centerLon: 0,
          radiusMeters: 100,
          propertyValues: {},
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) return;
    expect(result.failure._tag).toBe('NotFoundError');
  });
});
