/**
 * Integration test for CreatePropertySetUseCase. Creates a set on a
 * layer + emits PropertySetCreated; 404 on missing parent layer; 409
 * on duplicate (layerId, name) collision.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Result } from 'effect';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';

describe('CreatePropertySetUseCase (integration)', () => {
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
    const c = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(c)) throw new Error('client setup failed');
    const clientId = c.success.event.getData().clientId;

    const l = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createLayer.execute({
          clientId,
          code: 'L1',
          name: 'Layer 1',
          layerType: 'POINT',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(l)) throw new Error('layer setup failed');
    return { clientId, layerId: l.success.event.getData().layerId };
  }

  it('creates a property-set + emits PropertySetCreated', async () => {
    const { clientId, layerId } = await seedLayer();

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createPropertySet.execute({
          clientId,
          layerId,
          name: 'Defaults',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;

    const propertySetId = result.success.event.getData().propertySetId;
    expect(propertySetId).toMatch(/^pst_/);

    const set = await appContext.repositories.propertySets.findById(propertySetId as never);
    expect(set?.name).toBe('Defaults');
    expect(set?.layerId).toBe(layerId);
    expect(set?.properties).toEqual([]);

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:layers:property-set:created'
    `);
    expect(events.length).toBe(1);
  });

  it('404s when the parent layer is missing', async () => {
    const { clientId } = await seedLayer();
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createPropertySet.execute({
          clientId,
          layerId: 'lyr_NOPE',
          name: 'X',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) return;
    expect(result.failure._tag).toBe('NotFoundError');
  });

  it('409s a duplicate (layerId, name)', async () => {
    const { clientId, layerId } = await seedLayer();

    await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createPropertySet.execute({ clientId, layerId, name: 'Dup' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );

    const second = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createPropertySet.execute({ clientId, layerId, name: 'Dup' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isFailure(second)).toBe(true);
    if (!Result.isFailure(second)) return;
    expect(second.failure._tag).toBe('BusinessRuleViolation');
  });
});
