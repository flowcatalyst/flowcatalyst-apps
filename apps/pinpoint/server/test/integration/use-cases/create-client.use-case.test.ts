/**
 * End-to-end use-case integration test for CreateClientUseCase. Runs the
 * Effect through `appContext.runWrite`, which:
 *   - opens a Drizzle transaction,
 *   - binds it on the TransactionStore (ALS),
 *   - drains the Effect inside the AggregateRegistry + UoW Layers,
 *   - commits on success.
 *
 * Verifies both the aggregate row + the outbox audit log row landed in
 * the same tx.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Result } from 'effect';
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
      appContext.runWrite(
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
        // The runWrite signature still accepts a scope param for legacy
        // shape compat; the actual scope comes from ScopeStore.require
        // inside the use case.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );

    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;

    const clientId = result.success.event.getData().clientId;
    expect(clientId).toMatch(/^cli_/);

    // The aggregate row landed.
    const client = await appContext.repositories.clients.findById(clientId as never);
    expect(client?.name).toBe('Acme');
    expect(client?.code).toBe('ACME');

    // The outbox event landed in outbox_messages (the SDK table the
    // platform's fc-outbox-processor drains) in the same tx. `type`
    // is the message-kind discriminator (EVENT / AUDIT_LOG /
    // DISPATCH_JOB); the CloudEvents event-type code lives inside the
    // JSON payload.
    const events = await db.execute(sql`
      SELECT type, payload FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:tenancy:client:created'
    `);
    expect(events.length).toBe(1);

    // And a local audit_logs row landed for forensics — same tx,
    // different table, different concern.
    const audits = await db.execute(sql`
      SELECT entity_type, entity_id, operation FROM audit_logs
      WHERE entity_type = 'Client'
    `);
    expect(audits.length).toBe(1);
    expect(audits[0]?.['entity_id']).toBe(clientId);
  });

  it('rejects a duplicate code with a BusinessRuleViolation', async () => {
    await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'DUP' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );

    const second = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(
        appContext.useCases.createClient.execute({ name: 'Other', code: 'DUP' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );

    expect(Result.isFailure(second)).toBe(true);
    if (!Result.isFailure(second)) return;
    expect(second.failure._tag).toBe('BusinessRuleViolation');
  });
});
