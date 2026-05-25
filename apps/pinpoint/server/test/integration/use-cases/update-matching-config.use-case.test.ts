/**
 * Integration test for UpdateMatchingConfigUseCase. Verifies the lazy
 * promote-from-global-default behaviour: the use case sees no
 * client-scoped row, resolves to mcf_GLOBAL_DEFAULT, then writes a new
 * scoped row carrying the overrides. Second update on the same scope
 * touches the same row (not a new one).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { isFailure, isSuccess } from '@pinpoint/framework';

describe('UpdateMatchingConfigUseCase (integration)', () => {
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
    const r = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
      ),
    );
    if (!isSuccess(r)) throw new Error('setup failed');
    return r.value.getData().clientId;
  }

  it('promotes a scoped config from the global default + emits the event', async () => {
    const clientId = await createClient();

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.updateMatchingConfig.execute({
          clientId,
          streetThreshold: 0.7,
          overallThreshold: 0.9,
        }),
      ),
    );
    expect(isSuccess(result)).toBe(true);

    const config = await appContext.repositories.matchingConfigs.resolve(
      clientId as never,
      null,
    );
    expect(config.id).not.toBe('mcf_GLOBAL_DEFAULT');
    expect(config.clientId).toBe(clientId);
    expect(config.streetThreshold).toBe(0.7);
    expect(config.overallThreshold).toBe(0.9);
    // Untouched thresholds keep their global defaults.
    expect(config.houseNumberThreshold).toBe(1.0);

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:matching:config:updated'
    `);
    expect(events.length).toBe(1);
  });

  it('reuses the scoped row on a second update', async () => {
    const clientId = await createClient();

    await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.updateMatchingConfig.execute({
          clientId,
          streetThreshold: 0.7,
        }),
      ),
    );
    const after1 = await appContext.repositories.matchingConfigs.resolve(
      clientId as never,
      null,
    );

    await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.updateMatchingConfig.execute({
          clientId,
          streetThreshold: 0.5,
        }),
      ),
    );
    const after2 = await appContext.repositories.matchingConfigs.resolve(
      clientId as never,
      null,
    );

    // Same row, different value.
    expect(after2.id).toBe(after1.id);
    expect(after2.streetThreshold).toBe(0.5);
  });

  it('404s when the client does not exist', async () => {
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
appContext.useCases.updateMatchingConfig.execute({
          clientId: 'cli_NOPE',
          streetThreshold: 0.7,
        }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('not_found');
  });
});
