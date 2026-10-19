/**
 * Integration tests for verifier-backed matching (`matchLocation`) through
 * create-location and rematch-location, with the Clef verifier pointed at a
 * fetch-mocked SystemOne host. Each test decides the per-field verdicts the
 * "model" returns; the match rule itself (`decideAddressMatch`) is real.
 *
 * Setup: a VALIDATED master is seeded from ADDR_A. ADDR_B is the same place
 * written differently (different hash → no exact-match shortcut, high trigram
 * similarity → it is a candidate), so the verifier is consulted.
 *
 * Covers:
 *   - confirmed  → FUZZY match; `llm_verified` (confirmed) on the master's trail.
 *   - rejected   → fresh master, `created` reason `verifier_rejected`.
 *   - provider failure → `no_opinion`; no fallback scorer, so a fresh master.
 *   - threshold  → a confirmed verdict below the client's threshold doesn't win.
 *   - best of several → the highest-confidence confirmed candidate wins.
 *   - rematch    → same trail, entries tagged `trigger: 'rematch'`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { runInScope } from '../test-app-context.js';
import { installFetchMock, jsonResponse, type FetchMock } from '../fetch-mock.js';
import { createAppContext, type AppContext } from '../../../src/app-context.js';
import { isSuccess } from '@pinpoint/framework';
import { MasterLocation } from '../../../src/domain/locations/master-location.js';
import { asMasterLocationId } from '../../../src/domain/locations/ids.js';
import { ProcessingStep } from '../../../src/domain/locations/processing-log.repository.js';

const ADDR_A = '548 Market Street, South of Market, San Francisco, 94104';
const ADDR_B = '548 Market St, South of Market, San Francisco';
const SYSTEMONE = /clef\.invalid\/v1\/systemone/;

type Verdict = 'match' | 'mismatch' | 'missing';
const CORROBORATED: Record<string, Verdict> = {
  house_number: 'match',
  street: 'match',
  suburb: 'match',
  postal_code: 'missing',
  city: 'match',
};
const DIFFERENT_NUMBER: Record<string, Verdict> = { ...CORROBORATED, house_number: 'mismatch' };

/** A SystemOne response answering every field with `fields[id]` at probability `p`. */
function systemOne(fields: Record<string, Verdict>, p = 0.9): Response {
  const answers = Object.fromEntries(
    Object.entries(fields).map(([id, verdict]) => {
      const rest = (1 - p) / 2;
      const probabilities = { match: rest, mismatch: rest, missing: rest, [verdict]: p };
      return [id, { type: 'choice', choice: verdict, probabilities, confidence: p }];
    }),
  );
  return jsonResponse({ model: 'clef-test', answers });
}

/** The candidate address a SystemOne request is asking about. */
function candidateOf(init?: RequestInit): string {
  const body = JSON.parse(String(init?.body)) as { state: { candidate: { address: string } } };
  return body.state.candidate.address;
}

describe('matchLocation — verifier-backed matching (integration)', () => {
  let appContext: AppContext;
  let mock: FetchMock;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    // Same wiring as test-app-context, but with the Clef verifier so matching
    // actually consults the (mocked) decision model.
    appContext = await createAppContext({
      db,
      clientId: 'test',
      publicBaseUrl: 'http://localhost:3000',
      dispatchPoolCode: 'test-pool',
      geocodingApiUrl: 'http://geocoder.invalid',
      geocodingRateLimit: 5,
      addressVerifier: { provider: 'clef', baseUrl: 'http://clef.invalid', model: 'clef-test' },
      auth: {
        oidc: null,
        devFallback: false,
        postLoginRedirect: '/',
        session: { driver: 'memory', redisUrl: null },
      },
    });
    mock = installFetchMock();
  });

  afterAll(() => mock.restore());

  beforeEach(async () => {
    await cleanDb();
    mock.reset();
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
    const geocoded = MasterLocation.geocoded(
      pending,
      { latitude: 37.79, longitude: -122.4 },
      new Date(),
    );
    await appContext.repositories.masterLocations.persist(
      MasterLocation.confirmed(geocoded, new Date()),
    );
  }

  function trailOf(masterId: string) {
    return appContext.repositories.processingLog.listByMaster(asMasterLocationId(masterId));
  }

  /** Seed a VALIDATED master. No candidates exist yet, so no model call. */
  async function seedValidatedMaster(clientId: string, address = ADDR_A): Promise<string> {
    const a = await createLocation(clientId, address);
    await validateMaster(a.masterLocationId);
    return a.masterLocationId;
  }

  it('records a confirmed verdict on the matched master and keeps the match', async () => {
    const clientId = await setupClient();
    const masterId = await seedValidatedMaster(clientId);
    mock.handle('POST', SYSTEMONE, () => systemOne(CORROBORATED, 0.93));

    const b = await createLocation(clientId, ADDR_B);
    expect(b.masterLocationId).toBe(masterId);

    const location = await appContext.repositories.locations.findById(b.locationId as never);
    expect(location?.matchMethod).toBe('FUZZY');
    expect(location?.matchConfidence).toBeCloseTo(0.93, 10);

    const trail = await trailOf(masterId);
    const verified = trail.find((e) => e.step === ProcessingStep.LlmVerified);
    expect(verified?.data['outcome']).toBe('confirmed');
    expect(verified?.data['input_address']).toBe('548 market st, south of market, san francisco');
    expect(verified?.data['reasoning']).toContain('→ address_corroborated');
    expect(verified?.data['location_id']).toBe(b.locationId);
    expect(trail.map((e) => e.step)).toContain(ProcessingStep.Matched);
  });

  it('records a rejected verdict and creates a fresh master marked verifier_rejected', async () => {
    const clientId = await setupClient();
    const masterId = await seedValidatedMaster(clientId);
    mock.handle('POST', SYSTEMONE, () => systemOne(DIFFERENT_NUMBER));

    const b = await createLocation(clientId, ADDR_B);
    expect(b.masterLocationId).not.toBe(masterId);

    const verified = (await trailOf(masterId)).find((e) => e.step === ProcessingStep.LlmVerified);
    expect(verified?.data['outcome']).toBe('rejected');
    expect(verified?.data['reasoning']).toContain('house_number=mismatch');

    const created = (await trailOf(b.masterLocationId)).find(
      (e) => e.step === ProcessingStep.Created,
    );
    expect(created?.data['reason']).toBe('verifier_rejected');
    expect(created?.data['rejected_master_location_ids']).toEqual([masterId]);
  });

  it('records no_opinion on provider failure and does not match — there is no fallback scorer', async () => {
    const clientId = await setupClient();
    const masterId = await seedValidatedMaster(clientId);
    mock.handle('POST', SYSTEMONE, () => Promise.resolve(new Response('boom', { status: 500 })));

    const b = await createLocation(clientId, ADDR_B);
    expect(b.masterLocationId).not.toBe(masterId);

    const verified = (await trailOf(masterId)).find((e) => e.step === ProcessingStep.LlmVerified);
    expect(verified?.data['outcome']).toBe('no_opinion');
    const created = (await trailOf(b.masterLocationId)).find(
      (e) => e.step === ProcessingStep.Created,
    );
    expect(created?.data['reason']).toBe('no_match');
  });

  it("does not match a confirmed verdict below the client's threshold", async () => {
    const clientId = await setupClient();
    const masterId = await seedValidatedMaster(clientId);
    const raised = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.updateMatchingConfig.execute({ clientId, overallThreshold: 0.95 }),
      ),
    );
    expect(isSuccess(raised)).toBe(true);
    mock.handle('POST', SYSTEMONE, () => systemOne(CORROBORATED, 0.9));

    const b = await createLocation(clientId, ADDR_B);
    expect(b.masterLocationId).not.toBe(masterId);
    const verified = (await trailOf(masterId)).find((e) => e.step === ProcessingStep.LlmVerified);
    expect(verified?.data['outcome']).toBe('confirmed');
    expect(verified?.data['threshold']).toBe(0.95);
  });

  it('picks the highest-confidence confirmed candidate', async () => {
    const clientId = await setupClient();
    const weaker = await seedValidatedMaster(clientId, '548 Market Street, San Francisco, 94104');
    const stronger = await seedValidatedMaster(clientId, ADDR_A);
    mock.handle('POST', SYSTEMONE, (_url, init) =>
      systemOne(CORROBORATED, candidateOf(init).includes('south of market') ? 0.95 : 0.7),
    );

    // Seeding the second master already consulted the verifier once (unmocked
    // then → no opinion → its own master); count only the calls for ADDR_B.
    const before = mock.calls.length;
    const b = await createLocation(clientId, ADDR_B);
    expect(b.masterLocationId).toBe(stronger);
    expect(mock.calls.slice(before).filter((c) => SYSTEMONE.test(c))).toHaveLength(2);

    // The weaker candidate was confirmed too — it just lost on confidence.
    const weakerVerdict = (await trailOf(weaker)).findLast(
      (e) => e.step === ProcessingStep.LlmVerified,
    );
    expect(weakerVerdict?.data['outcome']).toBe('confirmed');
    expect(weakerVerdict?.data['confidence']).toBeCloseTo(0.7, 10);
  });

  it('rematch records the verdict and matched entries tagged trigger=rematch', async () => {
    const clientId = await setupClient();
    const masterId = await seedValidatedMaster(clientId);
    // A location somewhere unrelated (its own PENDING master, no candidates).
    const c = await createLocation(clientId, '1 Ocean Avenue, Cape Town');
    mock.handle('POST', SYSTEMONE, () => systemOne(CORROBORATED, 0.9));

    const r = await runInScope({ sub: 'prn_test' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.rematchLocation.execute({
          clientId,
          locationId: c.locationId,
          matchAddress: ADDR_B,
        }),
      ),
    );
    expect(isSuccess(r)).toBe(true);
    if (!isSuccess(r)) return;
    expect(r.value.getData().masterLocationId).toBe(masterId);

    const trail = await trailOf(masterId);
    const verified = trail.find((e) => e.step === ProcessingStep.LlmVerified);
    expect(verified?.data['outcome']).toBe('confirmed');
    expect(verified?.data['trigger']).toBe('rematch');
    expect(verified?.data['location_id']).toBe(c.locationId);

    const matched = trail.find((e) => e.step === ProcessingStep.Matched);
    expect(matched?.data['trigger']).toBe('rematch');
    expect(matched?.data['method']).toBe('FUZZY');
  });
});
