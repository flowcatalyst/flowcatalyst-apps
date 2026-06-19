/**
 * Integration test for UpdateLayerUseCase. Renames + emits
 * LayerUpdated; 404 on missing layer.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { isFailure, isSuccess } from '@pinpoint/framework';

describe('UpdateLayerUseCase (integration)', () => {
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

  async function seed(): Promise<{ clientId: string; layerId: string }> {
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
    return { clientId, layerId: l.value.getData().layerId };
  }

  it('renames the layer + emits LayerUpdated', async () => {
    const { clientId, layerId } = await seed();
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.updateLayer.execute({
          clientId,
          layerId,
          name: 'Stores (renamed)',
          centerLat: -26.2,
          centerLon: 28.05,
          radiusMeters: 5000,
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);

    const layer = await appContext.repositories.layers.findById(layerId as never);
    expect(layer?.name).toBe('Stores (renamed)');

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:layers:layer:updated'
    `);
    expect(events.length).toBe(1);
  });

  it('404s on a missing layer', async () => {
    const { clientId } = await seed();
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.updateLayer.execute({
          clientId,
          layerId: 'lyr_NOPE',
          name: 'X',
          centerLat: 0,
          centerLon: 0,
          radiusMeters: 100,
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('not_found');
  });
});
