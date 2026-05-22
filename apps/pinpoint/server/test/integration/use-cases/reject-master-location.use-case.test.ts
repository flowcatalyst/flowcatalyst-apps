/**
 * Integration test for RejectMasterLocationUseCase. Seeds a PENDING
 * master directly, runs the reject; verifies status → REJECTED +
 * MasterLocationRejected event. Optional `reason` is captured.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Result } from 'effect';
import { sql } from 'drizzle-orm';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  asMasterLocationId,
  MASTER_LOCATION_ID_PREFIX,
} from '../../../src/domain/locations/ids.js';
import { asClientId } from '../../../src/domain/tenancy/ids.js';
import { MasterLocation } from '../../../src/domain/locations/master-location.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';

describe('RejectMasterLocationUseCase (integration)', () => {
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

  async function seed(): Promise<{ clientId: string; masterLocationId: string }> {
    const c = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(c)) throw new Error('client setup failed');
    const clientId = c.success.event.getData().clientId;

    const now = new Date();
    const masterId = asMasterLocationId(
      `${MASTER_LOCATION_ID_PREFIX}_${generateTsid()}`,
    );
    const pending = MasterLocation.create({
      id: masterId,
      clientId: asClientId(clientId),
      partitionId: null,
      normalizedHouseNumber: null,
      normalizedRoad: null,
      normalizedSuburb: null,
      normalizedCity: 'Atlantis',
      normalizedState: null,
      normalizedPostalCode: null,
      normalizedCountry: 'Mythical',
      addressHash: 'junk-hash',
      normalizedAddressLine: 'Atlantis, Mythical',
      now,
    });
    await appContext.repositories.masterLocations.persist(pending);
    return { clientId, masterLocationId: masterId };
  }

  it('rejects a master with reason + emits MasterLocationRejected', async () => {
    const { clientId, masterLocationId } = await seed();

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.rejectMasterLocation.execute({
          clientId,
          masterLocationId,
          reason: 'Place does not exist',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isSuccess(result)).toBe(true);

    const master = await appContext.repositories.masterLocations.findById(
      masterLocationId as never,
    );
    expect(master?.status).toBe('REJECTED');

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:locations:master_location:rejected'
    `);
    expect(events.length).toBe(1);
  });

  it('404s on a missing master', async () => {
    const { clientId } = await seed();
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.rejectMasterLocation.execute({
          clientId,
          masterLocationId: 'mlo_NOPE',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) return;
    expect(result.failure._tag).toBe('NotFoundError');
  });
});
