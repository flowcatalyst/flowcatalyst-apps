/**
 * Integration test for DeleteLayerFeatureUseCase. Removes the feature
 * row, emits LayerFeatureDeleted, 404 on missing. First user of
 * commitDelete in the codebase per Slice 4.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Result } from 'effect';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';

describe('DeleteLayerFeatureUseCase (integration)', () => {
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
      appContext.runWrite(
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(c)) throw new Error('setup failed');
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
    const layerId = l.success.event.getData().layerId;

    const f = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(
        appContext.useCases.createLayerFeature.execute({
          layerId,
          label: 'Sandton',
          centerLat: -26.1075,
          centerLon: 28.0567,
          radiusMeters: 1500,
          propertyValues: {},
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(f)) throw new Error('feature setup failed');
    return { featureId: f.success.event.getData().featureId };
  }

  it('deletes the feature row + emits LayerFeatureDeleted', async () => {
    const { featureId } = await seedFeature();

    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(
        appContext.useCases.deleteLayerFeature.execute({ featureId }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isSuccess(result)).toBe(true);

    expect(await appContext.repositories.layerFeatures.findById(featureId as never)).toBeNull();

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:layers:feature:deleted'
    `);
    expect(events.length).toBe(1);
  });

  it('404s on a missing feature', async () => {
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(
        appContext.useCases.deleteLayerFeature.execute({ featureId: 'lfe_NOPE' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) return;
    expect(result.failure._tag).toBe('NotFoundError');
  });
});
