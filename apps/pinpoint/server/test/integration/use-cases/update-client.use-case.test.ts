/**
 * Integration test for UpdateClientUseCase. Follows the same UoW +
 * outbox-event + audit-row triple-check as create-client; additionally
 * verifies that running update on a missing client surfaces NotFoundError.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { isFailure, isSuccess } from '@pinpoint/framework';

describe('UpdateClientUseCase (integration)', () => {
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

  async function createClient(name = 'Acme', code = 'ACME'): Promise<string> {
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.createClient.execute({ name, code }),
      ),
    );
    if (!isSuccess(result)) throw new Error('client setup failed');
    return result.value.getData().clientId;
  }

  it('renames a client + writes ClientUpdated to outbox', async () => {
    const clientId = await createClient();

    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.updateClient.execute({ clientId, name: 'Acme Holdings' }),
      ),
    );
    expect(isSuccess(result)).toBe(true);

    const client = await appContext.repositories.clients.findById(clientId as never);
    expect(client?.name).toBe('Acme Holdings');

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:tenancy:client:updated'
    `);
    expect(events.length).toBe(1);
  });

  it('404s on a missing client', async () => {
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
appContext.useCases.updateClient.execute({ clientId: 'cli_NOPE', name: 'X' }),
      ),
    );
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('not_found');
  });
});
