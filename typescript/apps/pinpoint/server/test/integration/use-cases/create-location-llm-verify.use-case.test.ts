/**
 * Integration tests for the LLM-verification leg of the matching pipeline —
 * the `llm_verified` processing-log step added so the verifier's verdict
 * (including its reasoning) survives into the master's trail.
 *
 * The stock test app context wires the Noop verifier, so this file builds its
 * own AppContext with the Ollama provider pointed at a fetch-mocked
 * `http://ollama.invalid` — the verdict per test is whatever the mock returns.
 *
 * The fuzzy setup: ADDR_A parses WITH a postcode, ADDR_B parses identically
 * but WITHOUT one. Different address hashes (no exact-hash short-circuit),
 * but every compared component scores 1.0 (missing postcode is neutral), so
 * findMatch returns a FUZZY hit and the verifier fires.
 *
 * Covers:
 *   - confirmed  → match stands; `llm_verified` (outcome=confirmed) with the
 *     full verdict lands on the matched master's trail.
 *   - rejected   → match dropped; `llm_verified` (outcome=rejected) on the
 *     candidate; fresh master's `created` step says `llm_rejected` and points
 *     back at the rejected candidate.
 *   - provider failure → `llm_verified` (outcome=no_opinion) recorded; the
 *     algorithmic match stands.
 *   - rematch flow → same verdict trail, entries tagged `trigger: 'rematch'`.
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

const ADDR_A = '548 Market Street, San Francisco 94104';
const ADDR_B = '548 Market Street, San Francisco';

const PARSE_A = [
  { label: 'house_number', value: '548' },
  { label: 'road', value: 'market street' },
  { label: 'city', value: 'san francisco' },
  { label: 'state', value: 'ca' },
  { label: 'postcode', value: '94104' },
  { label: 'country', value: 'usa' },
];
// Same parse minus the postcode: different hash, fuzzy-identical otherwise.
const PARSE_B = PARSE_A.filter((c) => c.label !== 'postcode');

// Unrelated address (near-zero trigram similarity to the SF masters).
const PARSE_CT = [
  { label: 'house_number', value: '1' },
  { label: 'road', value: 'ocean avenue' },
  { label: 'city', value: 'cape town' },
  { label: 'country', value: 'south africa' },
];

function parseFor(address: string): Array<{ label: string; value: string }> {
  if (/ocean/i.test(address)) return PARSE_CT;
  return address === ADDR_B ? PARSE_B : PARSE_A;
}

function installLibpostalMock(mock: FetchMock): void {
  mock.handle('GET', /\/parse\b/, (url) =>
    jsonResponse(parseFor(url.searchParams.get('address') ?? '')),
  );
  mock.handle('GET', /\/expand\b/, (url) => jsonResponse([url.searchParams.get('address') ?? '']));
}

/** Canned Ollama /api/chat response wrapping a verifier verdict. */
function ollamaVerdict(verdict: {
  match_confirmed: boolean;
  confidence: number;
  reasoning: string;
}): Response {
  return jsonResponse({
    message: { role: 'assistant', content: JSON.stringify(verdict) },
    done: true,
  });
}

describe('CreateLocationUseCase — LLM verification trail (integration)', () => {
  let appContext: AppContext;
  let mock: FetchMock;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    // Dedicated context: same wiring as test-app-context, but with the Ollama
    // verifier so the pipeline actually calls the (mocked) LLM.
    appContext = await createAppContext({
      db,
      clientId: 'test',
      publicBaseUrl: 'http://localhost:3000',
      dispatchPoolCode: 'test-pool',
      geocodingApiUrl: 'http://geocoder.invalid',
      geocodingRateLimit: 5,
      addressVerifier: {
        provider: 'ollama',
        baseUrl: 'http://ollama.invalid',
        model: 'test-model',
      },
      libpostalUrl: 'http://libpostal.invalid',
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

  /** Seed a VALIDATED master via ADDR_A, ready to fuzzy-match ADDR_B. */
  async function seedValidatedMaster(clientId: string): Promise<string> {
    const a = await createLocation(clientId, ADDR_A);
    await validateMaster(a.masterLocationId);
    return a.masterLocationId;
  }

  it('records a confirmed verdict on the matched master and keeps the match', async () => {
    const clientId = await setupClient();
    const masterId = await seedValidatedMaster(clientId);

    // Trail rows for the fresh master now land inside the tx (FK fix).
    const seedTrail = await trailOf(masterId);
    expect(seedTrail.map((e) => e.step)).toEqual([
      ProcessingStep.Normalized,
      ProcessingStep.Created,
    ]);
    expect(seedTrail[1]?.data['reason']).toBe('no_match');

    mock.handle('POST', /ollama\.invalid\/api\/chat/, () =>
      ollamaVerdict({
        match_confirmed: true,
        confidence: 0.95,
        reasoning: 'Same street, number and city; only the postal code is missing.',
      }),
    );

    const b = await createLocation(clientId, ADDR_B);
    expect(b.masterLocationId).toBe(masterId);

    const location = await appContext.repositories.locations.findById(b.locationId as never);
    expect(location?.matchMethod).toBe('FUZZY');

    const trail = await trailOf(masterId);
    const verified = trail.find((e) => e.step === ProcessingStep.LlmVerified);
    expect(verified).toBeDefined();
    expect(verified?.data['outcome']).toBe('confirmed');
    expect(verified?.data['match_confirmed']).toBe(true);
    expect(verified?.data['confidence']).toBe(0.95);
    expect(verified?.data['reasoning']).toContain('postal code');
    expect(verified?.data['location_id']).toBe(b.locationId);
    // The verdict precedes the matched entry for the same location.
    expect(trail.map((e) => e.step)).toContain(ProcessingStep.Matched);
  });

  it('records a rejected verdict and creates a fresh master marked llm_rejected', async () => {
    const clientId = await setupClient();
    const masterId = await seedValidatedMaster(clientId);

    mock.handle('POST', /ollama\.invalid\/api\/chat/, () =>
      ollamaVerdict({
        match_confirmed: false,
        confidence: 0.85,
        reasoning: 'The postal codes disagree, so these are different premises.',
      }),
    );

    const b = await createLocation(clientId, ADDR_B);
    expect(b.masterLocationId).not.toBe(masterId);

    // Verdict lives on the candidate the LLM vetoed.
    const candidateTrail = await trailOf(masterId);
    const verified = candidateTrail.find((e) => e.step === ProcessingStep.LlmVerified);
    expect(verified?.data['outcome']).toBe('rejected');
    expect(verified?.data['reasoning']).toContain('different premises');

    // The fresh master's created step says why it exists.
    const newTrail = await trailOf(b.masterLocationId);
    expect(newTrail.map((e) => e.step)).toEqual([
      ProcessingStep.Normalized,
      ProcessingStep.Created,
    ]);
    const created = newTrail.find((e) => e.step === ProcessingStep.Created);
    expect(created?.data['reason']).toBe('llm_rejected');
    expect(created?.data['rejected_master_location_id']).toBe(masterId);
  });

  it('records no_opinion on provider failure and lets the algorithmic match stand', async () => {
    const clientId = await setupClient();
    const masterId = await seedValidatedMaster(clientId);

    mock.handle('POST', /ollama\.invalid\/api\/chat/, () =>
      Promise.resolve(new Response('boom', { status: 500 })),
    );

    const b = await createLocation(clientId, ADDR_B);
    expect(b.masterLocationId).toBe(masterId);

    const trail = await trailOf(masterId);
    const verified = trail.find((e) => e.step === ProcessingStep.LlmVerified);
    expect(verified?.data['outcome']).toBe('no_opinion');
    expect(verified?.data['match_confirmed']).toBeNull();
    expect(verified?.data['reasoning']).toBeNull();
  });

  it('rematch records the verdict and matched entries tagged trigger=rematch', async () => {
    const clientId = await setupClient();
    const masterId = await seedValidatedMaster(clientId);

    // A location somewhere unrelated (its own PENDING master).
    const c = await createLocation(clientId, '1 Ocean Avenue, Cape Town');

    mock.handle('POST', /ollama\.invalid\/api\/chat/, () =>
      ollamaVerdict({
        match_confirmed: true,
        confidence: 0.9,
        reasoning: 'Identical street address; postal code absent but consistent.',
      }),
    );

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
