/**
 * Integration test for CreateLocationUseCase — the matching pipeline
 * end-to-end. The use case calls libpostal via HTTP (the only external
 * service it touches in the unverified-LLM path), so we install the
 * global-fetch shim and return canned libpostal responses.
 *
 * The LLM verifier is `provider: 'none'` (Noop) in `test-app-context.ts`,
 * so no fetch is issued for verification. Photon is also unused on the
 * create-location path (that's `validate-master-location`'s job).
 *
 * Covers:
 *   - no-match path → creates a fresh master + location, emits
 *     MasterLocationCreated + LocationCreated.
 *   - exact-hash-match path → re-submitting the same address against
 *     an existing VALIDATED master reuses it, emits LocationCreated +
 *     LocationValidated (the master's already canonical, so the new
 *     location inherits).
 *   - external_id idempotency → second create with the same external_id
 *     returns the existing location's LocationCreated.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Result } from 'effect';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import { installFetchMock, jsonResponse, type FetchMock } from '../fetch-mock.js';
import type { AppContext } from '../../../src/app-context.js';

// Stub libpostal responses for a Market Street, San Francisco address.
const PARSE_RESPONSE = [
  { label: 'house_number', value: '548' },
  { label: 'road', value: 'market street' },
  { label: 'city', value: 'san francisco' },
  { label: 'state', value: 'ca' },
  { label: 'postcode', value: '94104' },
  { label: 'country', value: 'usa' },
];
const EXPAND_RESPONSE = ['market street'];

function installLibpostalMock(mock: FetchMock): void {
  mock.handle('GET', /\/parse\b/, () => jsonResponse(PARSE_RESPONSE));
  mock.handle('GET', /\/expand\b/, () => jsonResponse(EXPAND_RESPONSE));
}

describe('CreateLocationUseCase (integration)', () => {
  let appContext: AppContext;
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];
  let mock: FetchMock;

  beforeAll(async () => {
    const fixture = await getDbFixture();
    db = fixture.db;
    appContext = await getTestAppContext();
    mock = installFetchMock();
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(async () => {
    await cleanDb();
    mock.reset();
    installLibpostalMock(mock);
  });

  async function setupClient(): Promise<string> {
    const c = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(c)) throw new Error('client setup failed');
    return c.success.event.getData().clientId;
  }

  it('no-match path creates a fresh master + location', async () => {
    const clientId = await setupClient();

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createLocation.execute({
          clientId,
          address: '548 Market Street, San Francisco',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );

    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;

    const data = result.success.event.getData();
    expect(data.locationId).toMatch(/^loc_/);
    expect(data.masterLocationId).toMatch(/^mlo_/);

    // Both rows landed.
    const location = await appContext.repositories.locations.findById(
      data.locationId as never,
    );
    expect(location).not.toBeNull();
    expect(location?.status).toBe('PENDING');
    expect(location?.matchMethod).toBeNull();

    const master = await appContext.repositories.masterLocations.findById(
      data.masterLocationId as never,
    );
    expect(master?.status).toBe('PENDING');
    expect(master?.normalizedCity).toBe('san francisco');

    // Both events landed in the outbox.
    const events = await db.execute(sql`
      SELECT payload::jsonb->>'type' AS event_type FROM outbox_messages
      WHERE type = 'EVENT'
      ORDER BY created_at
    `);
    const eventTypes = events.map((e: Record<string, unknown>) => e['event_type']);
    expect(eventTypes).toContain('pinpoint:tenancy:client:created');
    expect(eventTypes).toContain('pinpoint:locations:master_location:created');
    expect(eventTypes).toContain('pinpoint:locations:location:created');
  });

  it('exact-hash-match against a VALIDATED master reuses it', async () => {
    const clientId = await setupClient();

    // First create: produces a PENDING master.
    const first = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createLocation.execute({
          clientId,
          address: '548 Market Street, San Francisco',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(first)) throw new Error('first create failed');
    const firstMasterId = first.success.event.getData().masterLocationId;

    // Promote the master straight to VALIDATED (skipping the geocode
    // step that this test isn't exercising — Photon would be the mock).
    const pending = await appContext.repositories.masterLocations.findById(
      firstMasterId as never,
    );
    if (!pending) throw new Error('master not found');
    const { MasterLocation } = await import('../../../src/domain/locations/master-location.js');
    const geocoded = MasterLocation.geocoded(
      pending,
      { latitude: 37.78999, longitude: -122.40085 },
      new Date(),
    );
    // The transition is named `confirmed` (it's what the
    // confirm-master-location use case calls); status becomes VALIDATED.
    const validated = MasterLocation.confirmed(geocoded, new Date());
    await appContext.repositories.masterLocations.persist(validated);

    // Second create of the same address — should hash-match the
    // VALIDATED master and reuse it instead of creating a new one.
    const second = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createLocation.execute({
          clientId,
          address: '548 Market Street, San Francisco',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(second)) throw new Error('second create failed');
    const secondData = second.success.event.getData();

    // Same master id reused, different location id.
    expect(secondData.masterLocationId).toBe(firstMasterId);
    expect(secondData.locationId).not.toBe(first.success.event.getData().locationId);

    // The second location should be VALIDATED (inheriting from the
    // VALIDATED master) and carry an EXACT_HASH match method.
    const secondLocation = await appContext.repositories.locations.findById(
      secondData.locationId as never,
    );
    expect(secondLocation?.status).toBe('VALIDATED');
    expect(secondLocation?.matchMethod).toBe('EXACT_HASH');

    // LocationValidated event emitted for the second create.
    const validatedEvents = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT'
        AND payload::jsonb->>'type' = 'pinpoint:locations:location:validated'
    `);
    expect(validatedEvents.length).toBe(1);
  });

  it('external_id idempotency: second create reuses the first row', async () => {
    const clientId = await setupClient();

    const first = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createLocation.execute({
          clientId,
          externalId: 'ext-123',
          address: '548 Market Street, San Francisco',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(first)) throw new Error('first create failed');
    const firstLocationId = first.success.event.getData().locationId;

    const second = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createLocation.execute({
          clientId,
          externalId: 'ext-123',
          address: 'this address would parse differently but is ignored',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(second)) throw new Error('second create failed');
    expect(second.success.event.getData().locationId).toBe(firstLocationId);
  });

  it('persists attributes alongside the new location', async () => {
    const clientId = await setupClient();

    const result = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(
        appContext.useCases.createLocation.execute({
          clientId,
          address: '548 Market Street, San Francisco',
          attributes: [
            { key: 'cost_centre', value: 'CC-001' },
            { key: 'tags', value: ['retail', 'flagship'] },
          ],
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        undefined as any,
      ),
    );
    if (!Result.isSuccess(result)) throw new Error('create failed');
    const locationId = result.success.event.getData().locationId;

    // Both attribute rows landed inside the runWrite tx — proves the
    // TransactionStore.require + insertMany(attrs, tx) fix. Without it
    // the FK to the still-uncommitted locations row would fail and
    // roll back the whole create.
    const attrs = await appContext.repositories.locationAttributes.listByLocation(
      locationId as never,
    );
    expect(attrs).toHaveLength(2);
    const byKey = Object.fromEntries(attrs.map((a) => [a.key, a.value]));
    expect(byKey['cost_centre']).toBe('CC-001');
    expect(byKey['tags']).toEqual(['retail', 'flagship']);
  });
});
