/**
 * End-to-end use-case integration test for ReplacePropertySetPropertiesUseCase.
 * Exercises:
 *   - the full runWrite tx + scope binding,
 *   - the PropertySet aggregate's child-row sync (delete-all + insert-all),
 *   - a PropertySetPropertiesReplaced event landing in outbox_messages.
 *
 * Builds up the prerequisite tree (client → layer → property-set) via
 * the actual use-cases — staying through `runWrite` for every write
 * means the test exercises the real wiring instead of bypassing it via
 * direct repo writes.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Result } from 'effect';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';

async function setup(ctx: AppContext) {
  // 1. create client
  const clientResult = await runInScope({ sub: 'prn_test' }, () =>
    ctx.runWrite(
      ctx.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      undefined as any,
    ),
  );
  if (!Result.isSuccess(clientResult)) throw new Error('createClient failed');
  const clientId = clientResult.success.event.getData().clientId;

  // 2. create layer
  const layerResult = await runInScope({ sub: 'prn_test' }, () =>
    ctx.runWrite(
      ctx.useCases.createLayer.execute({
        clientId,
        code: 'L1',
        name: 'Layer 1',
        layerType: 'POINT',
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      undefined as any,
    ),
  );
  if (!Result.isSuccess(layerResult)) throw new Error('createLayer failed');
  const layerId = layerResult.success.event.getData().layerId;

  // 3. create property-set
  const psResult = await runInScope({ sub: 'prn_test' }, () =>
    ctx.runWrite(
      ctx.useCases.createPropertySet.execute({
        clientId,
        layerId,
        name: 'Defaults',
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      undefined as any,
    ),
  );
  if (!Result.isSuccess(psResult)) throw new Error('createPropertySet failed');
  const propertySetId = psResult.success.event.getData().propertySetId;

  return { clientId, layerId, propertySetId };
}

describe('ReplacePropertySetPropertiesUseCase (integration)', () => {
  let ctx: AppContext;
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];

  beforeAll(async () => {
    const fixture = await getDbFixture();
    db = fixture.db;
    ctx = await getTestAppContext();
  });

  beforeEach(async () => {
    await cleanDb();
  });

  it('replaces a property set\'s child rows + emits PropertiesReplaced', async () => {
    const { clientId, layerId, propertySetId } = await setup(ctx);

    const result = await runInScope({ sub: 'prn_test' }, () =>
      ctx.runWrite(
        ctx.useCases.replacePropertySetProperties.execute({
          clientId,
          layerId,
          propertySetId,
          properties: [
            { key: 'color', value: 'red' },
            { key: 'priority', value: 'high' },
          ],
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isSuccess(result)).toBe(true);

    // Properties landed.
    const persisted = await ctx.repositories.propertySets.findById(propertySetId as never);
    expect(persisted?.properties).toHaveLength(2);
    expect(persisted?.properties.map((p) => p.key).sort()).toEqual(['color', 'priority']);

    // Event landed in outbox.
    const events = await db.execute(sql`
      SELECT payload FROM outbox_messages
      WHERE type = 'EVENT'
        AND payload::jsonb->>'type' = 'pinpoint:layers:property-set:properties-replaced'
    `);
    expect(events.length).toBe(1);
  });

  it('caps property count at 6', async () => {
    const { clientId, layerId, propertySetId } = await setup(ctx);

    const tooMany = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, value: `v${i}` }));
    const result = await runInScope({ sub: 'prn_test' }, () =>
      ctx.runWrite(
        ctx.useCases.replacePropertySetProperties.execute({
          clientId,
          layerId,
          propertySetId,
          properties: tooMany,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) return;
    expect(result.failure._tag).toBe('ValidationError');
  });

  it('rejects duplicate keys with a BusinessRuleViolation', async () => {
    const { clientId, layerId, propertySetId } = await setup(ctx);

    const result = await runInScope({ sub: 'prn_test' }, () =>
      ctx.runWrite(
        ctx.useCases.replacePropertySetProperties.execute({
          clientId,
          layerId,
          propertySetId,
          properties: [
            { key: 'k', value: 'a' },
            { key: 'k', value: 'b' },
          ],
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) return;
    expect(result.failure._tag).toBe('BusinessRuleViolation');
  });
});
