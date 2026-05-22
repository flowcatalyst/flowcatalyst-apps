/**
 * Integration test for UpdateMasterLocationUseCase. Seeds a PENDING
 * master directly, runs the manual edit, verifies the field update +
 * recomputed addressHash + MasterLocationUpdated event.
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

describe('UpdateMasterLocationUseCase (integration)', () => {
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
      normalizedRoad: 'Market St',
      normalizedSuburb: null,
      normalizedCity: 'San Franciso', // typo on purpose — what we'll fix
      normalizedState: 'CA',
      normalizedPostalCode: null,
      normalizedCountry: 'United States',
      addressHash: 'pre-update-hash',
      normalizedAddressLine: 'Market St, San Franciso, United States',
      now,
    });
    await appContext.repositories.masterLocations.persist(pending);
    return { clientId, masterLocationId: masterId };
  }

  it('updates normalized fields + recomputes hash + emits MasterLocationUpdated', async () => {
    const { clientId, masterLocationId } = await seed();

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.updateMasterLocation.execute({
          clientId,
          masterLocationId,
          normalizedHouseNumber: '548',
          normalizedRoad: 'Market Street',
          normalizedSuburb: null,
          normalizedCity: 'San Francisco',
          normalizedState: 'CA',
          normalizedPostalCode: '94104',
          normalizedCountry: 'United States',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    expect(Result.isSuccess(result)).toBe(true);

    const master = await appContext.repositories.masterLocations.findById(
      masterLocationId as never,
    );
    expect(master?.normalizedHouseNumber).toBe('548');
    expect(master?.normalizedCity).toBe('San Francisco');
    // Hash must have changed away from the seeded pre-update-hash.
    expect(master?.addressHash).not.toBe('pre-update-hash');
    // normalizedAddressLine reflects new fields.
    expect(master?.normalizedAddressLine).toContain('548');
    expect(master?.normalizedAddressLine).toContain('San Francisco');

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:locations:master_location:updated'
    `);
    expect(events.length).toBe(1);
  });

  it('404s on a missing master', async () => {
    const { clientId } = await seed();
    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.updateMasterLocation.execute({
          clientId,
          masterLocationId: 'mlo_NOPE',
          normalizedCity: 'X',
          normalizedCountry: 'Y',
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
