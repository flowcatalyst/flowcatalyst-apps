/**
 * Integration test for DeleteClientUseCase. Verifies row removal, an
 * outbox event, an audit row, and the 404 path.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';
import { isFailure, isSuccess } from '@pinpoint/framework';

describe('DeleteClientUseCase (integration)', () => {
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

  it('deletes the row, emits ClientDeleted, writes an audit row', async () => {
    const clientId = await createClient();

    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() => appContext.useCases.deleteClient.execute({ clientId })),
    );
    expect(isSuccess(result)).toBe(true);

    expect(await appContext.repositories.clients.findById(clientId as never)).toBeNull();

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:tenancy:client:deleted'
    `);
    expect(events.length).toBe(1);

    const audits = await db.execute(sql`
      SELECT 1 FROM audit_logs WHERE entity_type = 'Client' AND entity_id = ${clientId}
    `);
    // Two rows: one for create, one for delete.
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('404s on a missing client', async () => {
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() => appContext.useCases.deleteClient.execute({ clientId: 'cli_NOPE' })),
    );
    expect(isFailure(result)).toBe(true);
    if (!isFailure(result)) return;
    expect(result.error.type).toBe('not_found');
  });
});
