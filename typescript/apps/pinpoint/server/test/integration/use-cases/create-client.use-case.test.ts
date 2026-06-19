/**
 * End-to-end use-case integration test for CreateClientUseCase. Runs the
 * use case through `appContext.runWritePlain`, which:
 *   - opens a Drizzle transaction,
 *   - binds it on the TransactionStore (ALS),
 *   - invokes the thunk,
 *   - commits on success (or rolls back if the thunk throws).
 *
 * Verifies both the aggregate row + the outbox event + the local audit-log
 * row all landed in the same tx.
 *
 * `create-client` is the first use case migrated off Effect — sweep follows
 * the same shape: `Result.error(UseCaseError.x(...))` + plain async/await
 * + `result.value.getData()` to unwrap success.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isFailure, isSuccess } from '@pinpoint/framework';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';

describe('CreateClientUseCase (integration)', () => {
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

  it('persists a client and emits a ClientCreated audit-log row in the same tx', async () => {
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
      ),
    );

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;

    const clientId = result.value.getData().clientId;
    expect(clientId).toMatch(/^cli_/);

    const client = await appContext.repositories.clients.findById(clientId as never);
    expect(client?.name).toBe('Acme');
    expect(client?.code).toBe('ACME');

    const events = await db.execute(sql`
      SELECT type, payload FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:tenancy:client:created'
    `);
    expect(events.length).toBe(1);

    const audits = await db.execute(sql`
      SELECT entity_type, entity_id, operation FROM audit_logs
      WHERE entity_type = 'Client'
    `);
    expect(audits.length).toBe(1);
    expect(audits[0]?.['entity_id']).toBe(clientId);
  });

  it('rejects a duplicate code with a BusinessRuleViolation', async () => {
    await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'DUP' }),
      ),
    );

    const second = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.createClient.execute({ name: 'Other', code: 'DUP' }),
      ),
    );

    expect(isFailure(second)).toBe(true);
    if (!isFailure(second)) return;
    expect(second.error.type).toBe('business_rule');
    expect(second.error.code).toBe('CLIENT_CODE_EXISTS');
  });
});
