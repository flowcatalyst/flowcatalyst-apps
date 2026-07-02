/**
 * Integration test for RematchLocationUseCase — the edit-match-address +
 * re-run-matching flow. Uses the libpostal fetch shim (returning a different
 * parse per address) to drive matching, and seeds a VALIDATED master directly
 * (skipping the Photon geocode step, as create-location's test does).
 *
 * Covers the three branches + the orphan-cleanup rule:
 *   - rematch to an address that hash-matches a VALIDATED master → re-point +
 *     validate; the old orphaned PENDING master is deleted (cascade).
 *   - rematch when another location still links to the old master → old master
 *     is kept, only this association moves.
 *   - rematch to a no-match address → a fresh PENDING master is created and the
 *     old orphaned PENDING master is deleted.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { generateTsid } from '@flowcatalyst/sdk';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import { installFetchMock, jsonResponse, type FetchMock } from '../fetch-mock.js';
import type { AppContext } from '../../../src/app-context.js';
import { isSuccess } from '@pinpoint/framework';
import { MasterLocation } from '../../../src/domain/locations/master-location.js';
import type { Location } from '../../../src/domain/locations/location.js';
import { asLocationId, asMasterLocationId, LOCATION_ID_PREFIX } from '../../../src/domain/locations/ids.js';
import { asClientId } from '../../../src/domain/tenancy/ids.js';

const ADDR_SF = '548 Market Street, San Francisco';
const ADDR_CT = '1 Ocean Avenue, Cape Town';

// Distinct parses so the two addresses produce different hashes AND lines with
// near-zero trigram similarity (so ADDR_CT never fuzzy-matches an SF master).
function parseFor(address: string): Array<{ label: string; value: string }> {
  if (/market/i.test(address)) {
    return [
      { label: 'house_number', value: '548' },
      { label: 'road', value: 'market street' },
      { label: 'city', value: 'san francisco' },
      { label: 'state', value: 'ca' },
      { label: 'country', value: 'usa' },
    ];
  }
  return [
    { label: 'house_number', value: '1' },
    { label: 'road', value: 'ocean avenue' },
    { label: 'city', value: 'cape town' },
    { label: 'country', value: 'south africa' },
  ];
}

function installLibpostalMock(mock: FetchMock): void {
  mock.handle('GET', /\/parse\b/, (url) =>
    jsonResponse(parseFor(url.searchParams.get('address') ?? '')),
  );
  mock.handle('GET', /\/expand\b/, (url) => jsonResponse([url.searchParams.get('address') ?? '']));
}

describe('RematchLocationUseCase (integration)', () => {
  let appContext: AppContext;
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];
  let mock: FetchMock;

  beforeAll(async () => {
    const fixture = await getDbFixture();
    db = fixture.db;
    appContext = await getTestAppContext();
    mock = installFetchMock();
  });

  afterAll(() => mock.restore());

  beforeEach(async () => {
    await cleanDb();
    mock.reset();
    installLibpostalMock(mock);
  });

  async function setupClient(): Promise<string> {
    const c = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
      ),
    );
    if (!isSuccess(c)) throw new Error('client setup failed');
    return c.value.getData().clientId;
  }

  /** Create a location for `address`, returning its + its master's ids. */
  async function createLocation(clientId: string, address: string) {
    const r = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() => appContext.useCases.createLocation.execute({ clientId, address })),
    );
    if (!isSuccess(r)) throw new Error(`create-location failed for ${address}`);
    return r.value.getData();
  }

  /** Promote an existing PENDING master straight to VALIDATED. */
  async function validateMaster(masterId: string): Promise<void> {
    const pending = await appContext.repositories.masterLocations.findById(masterId as never);
    if (!pending) throw new Error('master not found');
    const geocoded = MasterLocation.geocoded(pending, { latitude: 37.79, longitude: -122.4 }, new Date());
    await appContext.repositories.masterLocations.persist(MasterLocation.confirmed(geocoded, new Date()));
  }

  function rematch(clientId: string, locationId: string, matchAddress: string) {
    return runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.rematchLocation.execute({ clientId, locationId, matchAddress }),
      ),
    );
  }

  it('re-points to a matched VALIDATED master and deletes the orphaned PENDING master', async () => {
    const clientId = await setupClient();

    // Master A: a VALIDATED SF master (created via create-location, then promoted).
    const a = await createLocation(clientId, ADDR_SF);
    await validateMaster(a.masterLocationId);

    // Location L on a fresh PENDING master B (Cape Town — no validated match).
    const l = await createLocation(clientId, ADDR_CT);
    expect(l.masterLocationId).not.toBe(a.masterLocationId);

    // Rematch L's address to the SF one → hash-matches VALIDATED master A.
    const result = await rematch(clientId, l.locationId, ADDR_SF);
    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;
    const data = result.value.getData();

    expect(data.masterLocationId).toBe(a.masterLocationId);
    expect(data.previousMasterLocationId).toBe(l.masterLocationId);
    expect(data.previousMasterDeleted).toBe(true);
    expect(data.status).toBe('VALIDATED');

    const location = await appContext.repositories.locations.findById(l.locationId as never);
    expect(location?.masterLocationId).toBe(a.masterLocationId);
    expect(location?.matchAddress).toBe(ADDR_SF);
    expect(location?.status).toBe('VALIDATED');
    expect(location?.matchMethod).toBe('EXACT_HASH');

    // Old PENDING master B is gone.
    const oldMaster = await appContext.repositories.masterLocations.findById(
      l.masterLocationId as never,
    );
    expect(oldMaster).toBeNull();

    const events = await db.execute(sql`
      SELECT payload::jsonb->>'type' AS t FROM outbox_messages WHERE type = 'EVENT'
    `);
    const types = events.map((e: Record<string, unknown>) => e['t']);
    expect(types).toContain('pinpoint:locations:location:rematched');
    expect(types).toContain('pinpoint:locations:master_location:deleted');
  });

  it('keeps the old master when another location still links to it', async () => {
    const clientId = await setupClient();

    const a = await createLocation(clientId, ADDR_SF);
    await validateMaster(a.masterLocationId);

    // L1 → PENDING master B.
    const l1 = await createLocation(clientId, ADDR_CT);
    const masterB = l1.masterLocationId;

    // A second location L2 also linked to master B (persisted directly).
    const l2: Location = {
      id: asLocationId(`${LOCATION_ID_PREFIX}_${generateTsid()}`),
      clientId: asClientId(clientId),
      partitionId: null,
      masterLocationId: asMasterLocationId(masterB),
      externalId: null,
      name: null,
      rawAddressLine1: ADDR_CT,
      matchAddress: ADDR_CT,
      rawAddressLine2: null,
      rawSuburb: null,
      rawCity: 'cape town',
      rawState: null,
      rawPostalCode: null,
      rawCountry: 'south africa',
      normalizedHouseNumber: null,
      normalizedRoad: null,
      normalizedSuburb: null,
      normalizedCity: null,
      normalizedState: null,
      normalizedPostalCode: null,
      normalizedCountry: null,
      addressHash: null,
      matchConfidence: null,
      matchMethod: null,
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await appContext.repositories.locations.persist(l2);

    // Rematch L1 to the SF master.
    const result = await rematch(clientId, l1.locationId, ADDR_SF);
    if (!isSuccess(result)) throw new Error('rematch failed');
    const data = result.value.getData();

    expect(data.masterLocationId).toBe(a.masterLocationId);
    expect(data.previousMasterDeleted).toBe(false);

    // Master B still exists (L2 still links to it); L2's link is unchanged.
    const oldMaster = await appContext.repositories.masterLocations.findById(masterB as never);
    expect(oldMaster).not.toBeNull();
    const l2After = await appContext.repositories.locations.findById(l2.id);
    expect(l2After?.masterLocationId).toBe(masterB);
  });

  it('re-matching to a no-match address creates a fresh PENDING master + drops the old one', async () => {
    const clientId = await setupClient();

    // L on PENDING master A (no validated masters exist).
    const l = await createLocation(clientId, ADDR_SF);
    const masterA = l.masterLocationId;

    // Rematch to a different, unmatched address → new PENDING master.
    const result = await rematch(clientId, l.locationId, ADDR_CT);
    if (!isSuccess(result)) throw new Error('rematch failed');
    const data = result.value.getData();

    expect(data.masterLocationId).not.toBe(masterA);
    expect(data.previousMasterDeleted).toBe(true);
    expect(data.status).toBe('PENDING');

    const location = await appContext.repositories.locations.findById(l.locationId as never);
    expect(location?.matchAddress).toBe(ADDR_CT);
    expect(location?.masterLocationId).toBe(data.masterLocationId);

    const oldMaster = await appContext.repositories.masterLocations.findById(masterA as never);
    expect(oldMaster).toBeNull();

    const newMaster = await appContext.repositories.masterLocations.findById(
      data.masterLocationId as never,
    );
    expect(newMaster?.status).toBe('PENDING');
  });
});
