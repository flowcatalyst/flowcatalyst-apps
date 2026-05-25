/**
 * Integration test for UpdatePropertySetUseCase. Renames the set;
 * emits PropertySetUpdated; 404 on missing.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { isFailure, isSuccess } from '@pinpoint/framework';

describe('UpdatePropertySetUseCase (integration)', () => {
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
appContext.useCases.createPropertySet.execute({ clientId, layerId, name: 'Original' }),
      ),
    );
    if (!isSuccess(p)) throw new Error('ps setup failed');
    return { clientId, layerId, propertySetId: p.value.getData().propertySetId };
  }

  it('renames the set + emits PropertySetUpdated', async () => {
    const { clientId, layerId, propertySetId } = await seed();
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.updatePropertySet.execute({
          clientId,
          layerId,
          propertySetId,
          name: 'Renamed',
          description: 'changed',
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);

    const set = await appContext.repositories.propertySets.findById(propertySetId as never);
    expect(set?.name).toBe('Renamed');
    expect(set?.description).toBe('changed');

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:layers:property-set:updated'
    `);
    expect(events.length).toBe(1);
  });

  it('404s on a missing property-set', async () => {
    const { clientId, layerId } = await seed();
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.updatePropertySet.execute({
          clientId,
          layerId,
          propertySetId: 'pst_NOPE',
          name: 'X',
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('not_found');
  });
});
