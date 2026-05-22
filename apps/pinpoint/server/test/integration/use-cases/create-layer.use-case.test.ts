/**
 * Integration test for CreateLayerUseCase. Verifies RADIUS happy path,
 * geometry-required validation for each layer type, and duplicate-code
 * conflict.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Result } from 'effect';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';

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
      appContext.runWrite(
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(r)) throw new Error('setup failed');
    return r.success.event.getData().clientId;
  }

  it('creates a RADIUS layer + emits LayerCreated', async () => {
    const clientId = await createClient();

    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(
        appContext.useCases.createLayer.execute({
          clientId,
          code: 'jhb-stores',
          name: 'JHB Stores',
          layerType: 'RADIUS',
          centerLat: -26.2,
          centerLon: 28.05,
          radiusMeters: 5000,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;

    const layerId = result.success.event.getData().layerId;
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
      appContext.runWrite(
        appContext.useCases.createLayer.execute({
          clientId,
          code: 'bad',
          name: 'Bad',
          layerType: 'RADIUS',
          radiusMeters: 100,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) return;
    expect(result.failure._tag).toBe('ValidationError');
  });

  it('rejects POLYGON without geojson', async () => {
    const clientId = await createClient();
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(
        appContext.useCases.createLayer.execute({
          clientId,
          code: 'bad-poly',
          name: 'Bad Poly',
          layerType: 'POLYGON',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) return;
    expect(result.failure._tag).toBe('ValidationError');
  });

  it('409s a duplicate code within the same client', async () => {
    const clientId = await createClient();
    const first = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(
        appContext.useCases.createLayer.execute({
          clientId,
          code: 'shared',
          name: 'First',
          layerType: 'RADIUS',
          centerLat: 0,
          centerLon: 0,
          radiusMeters: 100,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isSuccess(first)).toBe(true);

    const second = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(
        appContext.useCases.createLayer.execute({
          clientId,
          code: 'shared',
          name: 'Second',
          layerType: 'RADIUS',
          centerLat: 1,
          centerLon: 1,
          radiusMeters: 100,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isFailure(second)).toBe(true);
    if (!Result.isFailure(second)) return;
    expect(second.failure._tag).toBe('BusinessRuleViolation');
  });
});
