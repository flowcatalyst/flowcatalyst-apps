/**
 * Integration test for CreateLayerUseCase. Verifies RADIUS happy path,
 * geometry-required validation for each layer type, and duplicate-code
 * conflict.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { isFailure, isSuccess } from '@pinpoint/framework';

describe('CreateLayerUseCase (integration)', () => {
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

  it('creates a RADIUS layer + emits LayerCreated', async () => {
    const clientId = await createClient();

    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createLayer.execute({
          clientId,
          code: 'jhb-stores',
          name: 'JHB Stores',
          layerType: 'RADIUS',
          centerLat: -26.2,
          centerLon: 28.05,
          radiusMeters: 5000,
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;

    const layerId = result.value.getData().layerId;
    expect(layerId).toMatch(/^lyr_/);

    const layer = await appContext.repositories.layers.findById(layerId as never);
    expect(layer?.layerType).toBe('RADIUS');
    expect(layer?.code).toBe('jhb-stores');

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:layers:layer:created'
    `);
    expect(events.length).toBe(1);
  });

  it('rejects RADIUS without center lat/lon', async () => {
    const clientId = await createClient();
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createLayer.execute({
          clientId,
          code: 'bad',
          name: 'Bad',
          layerType: 'RADIUS',
          radiusMeters: 100,
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('validation');
  });

  it('rejects POLYGON without geojson', async () => {
    const clientId = await createClient();
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createLayer.execute({
          clientId,
          code: 'bad-poly',
          name: 'Bad Poly',
          layerType: 'POLYGON',
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('validation');
  });

  it('409s a duplicate code within the same client', async () => {
    const clientId = await createClient();
    const first = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createLayer.execute({
          clientId,
          code: 'shared',
          name: 'First',
          layerType: 'RADIUS',
          centerLat: 0,
          centerLon: 0,
          radiusMeters: 100,
        }),
      ),
    );
    expect(isSuccess(first)).toBe(true);

    const second = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createLayer.execute({
          clientId,
          code: 'shared',
          name: 'Second',
          layerType: 'RADIUS',
          centerLat: 1,
          centerLon: 1,
          radiusMeters: 100,
        }),
      ),
    );
    expect(isFailure(second)).toBe(true);
    if (!isFailure(second)) return;
    expect(second.error.type).toBe('business_rule');
  });
});
