/**
 * Integration test for DeletePropertySetUseCase. Removes the set,
 * child property rows cascade on FK; emits PropertySetDeleted; 404.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { isFailure, isSuccess } from '@pinpoint/framework';

describe('DeletePropertySetUseCase (integration)', () => {
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

  async function seed(): Promise<{
    clientId: string;
    layerId: string;
    propertySetId: string;
  }> {
    const c = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
      ),
    );
    if (!isSuccess(c)) throw new Error('client setup failed');
    const clientId = c.value.getData().clientId;

    const l = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.createLayer.execute({
          clientId,
          code: 'L1',
          name: 'L',
          layerType: 'POINT',
        }),
      ),
    );
    if (!isSuccess(l)) throw new Error('layer setup failed');
    const layerId = l.value.getData().layerId;

    const p = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.createPropertySet.execute({ clientId, layerId, name: 'X' }),
      ),
    );
    if (!isSuccess(p)) throw new Error('ps setup failed');
    return { clientId, layerId, propertySetId: p.value.getData().propertySetId };
  }

  it('deletes the set + emits PropertySetDeleted', async () => {
    const { clientId, layerId, propertySetId } = await seed();
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.deletePropertySet.execute({
          clientId,
          layerId,
          propertySetId,
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);

    expect(await appContext.repositories.propertySets.findById(propertySetId as never)).toBeNull();

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:layers:property-set:deleted'
    `);
    expect(events.length).toBe(1);
  });

  it('404s on a missing property-set', async () => {
    const { clientId, layerId } = await seed();
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.deletePropertySet.execute({
          clientId,
          layerId,
          propertySetId: 'pst_NOPE',
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('not_found');
  });
});
