import { createHmac } from 'node:crypto';
import type { Api } from './client.js';
import { ApiCallError, ok } from './client.js';
import type { Report } from './report.js';
import { CBD, SEA_POINT, STELLENBOSCH, type Seeded } from './seed.js';

export interface FlowOptions {
  readonly baseUrl: string;
  readonly signingSecret: string | undefined;
}

type MasterStatus = 'PENDING' | 'GEOCODED' | 'VALIDATED' | 'REJECTED';

async function getMaster(api: Api, clientId: string, masterLocationId: string) {
  return ok(
    api.GET('/bff/clients/{clientId}/master-locations/{masterLocationId}', {
      params: { path: { clientId, masterLocationId } },
    }),
  );
}
async function getLocation(api: Api, clientId: string, locationId: string) {
  return ok(
    api.GET('/bff/clients/{clientId}/locations/{locationId}', {
      params: { path: { clientId, locationId } },
    }),
  );
}
async function processingSteps(
  api: Api,
  clientId: string,
  masterLocationId: string,
): Promise<string[]> {
  const log = await ok(
    api.GET('/bff/clients/{clientId}/master-locations/{masterLocationId}/processing-log', {
      params: { path: { clientId, masterLocationId } },
    }),
  );
  return log.map((e) => e.step);
}

/** When a location landed on an unexpected master, print why the pipeline created a new one. */
async function explainMaster(api: Api, r: Report, clientId: string, masterLocationId: string) {
  const m = await getMaster(api, clientId, masterLocationId);
  r.note(
    `new master ${m.id}: "${m.address}" city=${m.city} postal=${m.postalCode} country=${m.country} hash=${m.addressHash.slice(0, 12)}…`,
  );
  const log = await ok(
    api.GET('/bff/clients/{clientId}/master-locations/{masterLocationId}/processing-log', {
      params: { path: { clientId, masterLocationId } },
    }),
  );
  for (const e of log) r.note(`  log ${e.step}: ${JSON.stringify(e.data).slice(0, 220)}`);
}

async function createLocation(
  api: Api,
  clientId: string,
  partitionId: string,
  address: string,
  name: string,
  externalId?: string,
) {
  const created = await ok(
    api.POST('/bff/clients/{clientId}/locations', {
      params: { path: { clientId } },
      body: { partitionId, address, name, externalId: externalId ?? null, countryCode: 'ZA' },
    }),
  );
  const detail = await getLocation(api, clientId, created.id);
  return { created, detail };
}

/**
 * Bring a master to GEOCODED: Photon forward geocode via the BFF; if Photon
 * is unreachable (offline / rate-limited) fall back to the operator
 * confirm-geocode flow with the known coordinates — which also validates.
 */
async function geocodeOrConfirm(
  api: Api,
  r: Report,
  clientId: string,
  masterLocationId: string,
  fallback: {
    lat: number;
    lon: number;
    city: string;
    road: string | null;
    houseNumber: string | null;
    postalCode: string | null;
  },
): Promise<'photon' | 'operator'> {
  try {
    const m = await ok(
      api.POST('/bff/clients/{clientId}/master-locations/{masterLocationId}/geocode', {
        params: { path: { clientId, masterLocationId } },
      }),
    );
    r.note(`Photon geocoded → ${m.latitude}, ${m.longitude} (${m.status})`);
    return 'photon';
  } catch (err) {
    r.skip(
      `Photon geocode unavailable (${err instanceof Error ? err.message : String(err)}) — using operator confirm-geocode`,
    );
    await ok(
      api.POST('/bff/clients/{clientId}/master-locations/{masterLocationId}/confirm-geocode', {
        params: { path: { clientId, masterLocationId } },
        body: {
          houseNumber: fallback.houseNumber,
          road: fallback.road,
          city: fallback.city,
          postalCode: fallback.postalCode,
          country: 'South Africa',
          latitude: fallback.lat,
          longitude: fallback.lon,
        },
      }),
    );
    return 'operator';
  }
}

function signJob(secret: string, rawBody: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', secret).update(`${ts}${rawBody}`).digest('hex');
  return { 'x-flowcatalyst-timestamp': ts, 'x-flowcatalyst-signature': sig };
}

export interface FlowState {
  locationA?: string | undefined;
  masterA?: string | undefined;
  locationB?: string | undefined;
  locationC?: string | undefined;
  locationD?: string | undefined;
  masterD?: string | undefined;
  locationE?: string | undefined;
  masterE?: string | undefined;
}

export async function runFlows(
  api: Api,
  r: Report,
  seeded: Seeded,
  opts: FlowOptions,
): Promise<FlowState> {
  const { clientId, defaultPartitionId: partitionId } = seeded;
  const st: FlowState = {};

  await r.step('Create location A (new address → new PENDING master)', async () => {
    const { created, detail } = await createLocation(
      api,
      clientId,
      partitionId,
      '12 Long Street, Cape Town, 8001',
      'Head office',
      'A-001',
    );
    st.locationA = created.id;
    st.masterA = created.masterLocationId ?? undefined;
    r.note(
      `location ${created.id} status=${created.status} master=${created.masterLocationId} method=${detail.matchMethod}`,
    );
    r.expect(created.status === 'PENDING', 'location starts PENDING');
    r.expect(!!created.masterLocationId, 'a master location was created and linked');
    r.expect(detail.matchMethod === null, 'no match method — this is a brand-new master');
    if (st.masterA) {
      const m = await getMaster(api, clientId, st.masterA);
      r.note(
        `master ${m.id} "${m.address}" status=${m.status} hash=${m.addressHash.slice(0, 12)}…`,
      );
      r.expect(m.status === 'PENDING', 'master starts PENDING (no coordinates yet)');
      const steps = await processingSteps(api, clientId, st.masterA);
      r.note(`processing log: ${steps.join(' → ')}`);
      r.expect(
        steps.includes('normalized') && steps.includes('created'),
        'processing log records normalized + created',
      );
    }
  });

  await r.step('Idempotent create: same externalId is a no-op', async () => {
    const { created } = await createLocation(
      api,
      clientId,
      partitionId,
      '12 Long Street, Cape Town, 8001',
      'Head office',
      'A-001',
    );
    r.expect(created.id === st.locationA, 'same externalId returns the existing location');
  });

  await r.step('Geocode master A (Photon, or operator confirm-geocode fallback)', async () => {
    if (!st.masterA) throw new Error('no master A');
    const how = await geocodeOrConfirm(api, r, clientId, st.masterA, {
      ...CBD,
      city: 'Cape Town',
      road: 'Long Street',
      houseNumber: '12',
      postalCode: '8001',
    });
    const m = await getMaster(api, clientId, st.masterA);
    r.expect(m.latitude !== null && m.longitude !== null, 'master has coordinates');
    r.expect(
      (m.status as MasterStatus) === (how === 'photon' ? 'GEOCODED' : 'VALIDATED'),
      `master is ${how === 'photon' ? 'GEOCODED' : 'VALIDATED (operator flow confirms as well)'}`,
    );
  });

  await r.step(
    'Confirm master A (canonicalise → VALIDATED, children validated, features associated)',
    async () => {
      if (!st.masterA || !st.locationA) throw new Error('no master A');
      const before = await getMaster(api, clientId, st.masterA);
      if (before.status !== 'VALIDATED') {
        await ok(
          api.POST('/bff/clients/{clientId}/master-locations/{masterLocationId}/validate', {
            params: { path: { clientId, masterLocationId: st.masterA } },
          }),
        );
      }
      const m = await getMaster(api, clientId, st.masterA);
      r.expect(m.status === 'VALIDATED', 'master is VALIDATED');
      const loc = await getLocation(api, clientId, st.locationA);
      r.expect(loc.status === 'VALIDATED', 'child location flipped to VALIDATED');
      r.note(
        `features on location: ${loc.features.map((f) => `${f.layerName}/${f.featureLabel}`).join(', ') || '(none)'}`,
      );
      r.expect(
        loc.features.some((f) => f.featureLabel === 'CBD'),
        'CBD polygon feature associated (point-in-polygon)',
      );
      r.expect(
        !loc.features.some((f) => f.featureLabel === 'Stellenbosch'),
        'Stellenbosch feature NOT associated',
      );
    },
  );

  await r.step(
    'Create B: abbreviated variant (St → Street) → matches master A (hash or fuzzy)',
    async () => {
      const { created, detail } = await createLocation(
        api,
        clientId,
        partitionId,
        '12 Long St, Cape Town 8001',
        'Branch (abbreviated)',
        'B-001',
      );
      st.locationB = created.id;
      r.note(
        `location ${created.id} status=${created.status} master=${created.masterLocationId} method=${detail.matchMethod} confidence=${created.matchConfidence}`,
      );
      r.expect(created.masterLocationId === st.masterA, 'linked to master A');
      r.expect(
        detail.matchMethod === 'FUZZY' || detail.matchMethod === 'EXACT_HASH',
        `matched (${detail.matchMethod})`,
      );
      r.expect(
        created.status === 'VALIDATED',
        'validated immediately (master already VALIDATED with coords)',
      );
      r.expect(
        detail.features.some((f) => f.featureLabel === 'CBD'),
        'inherits the CBD feature association',
      );
    },
  );

  await r.step('Create C: exact duplicate → EXACT_HASH onto master A', async () => {
    const { created, detail } = await createLocation(
      api,
      clientId,
      partitionId,
      '12 Long Street, Cape Town, 8001',
      'Exact duplicate',
      'C-001',
    );
    st.locationC = created.id;
    r.note(
      `location ${created.id} method=${detail.matchMethod} confidence=${created.matchConfidence}`,
    );
    r.expect(created.masterLocationId === st.masterA, 'linked to master A');
    if (created.masterLocationId && created.masterLocationId !== st.masterA)
      await explainMaster(api, r, clientId, created.masterLocationId);
    r.expect(detail.matchMethod === 'EXACT_HASH', 'matched by address hash');
    r.expect(created.matchConfidence === 1, 'confidence 1.0');
  });

  await r.step('Create D (Sea Point) and E (Stellenbosch): two new PENDING masters', async () => {
    const d = await createLocation(
      api,
      clientId,
      partitionId,
      '45 Main Road, Sea Point, Cape Town, 8005',
      'Sea Point store',
      'D-001',
    );
    const e = await createLocation(
      api,
      clientId,
      partitionId,
      '1 Dorp Street, Stellenbosch, 7600',
      'Winelands store',
      'E-001',
    );
    st.locationD = d.created.id;
    st.masterD = d.created.masterLocationId ?? undefined;
    st.locationE = e.created.id;
    st.masterE = e.created.masterLocationId ?? undefined;
    r.note(`D master=${st.masterD}  E master=${st.masterE}`);
    r.expect(
      !!st.masterD && !!st.masterE && st.masterD !== st.masterE && st.masterD !== st.masterA,
      'two distinct new masters',
    );
  });

  await r.step(
    'Geocode D and E, then fire the scheduled validation job (HMAC-signed webhook)',
    async () => {
      if (!st.masterD || !st.masterE) throw new Error('no masters D/E');
      await geocodeOrConfirm(api, r, clientId, st.masterD, {
        ...SEA_POINT,
        city: 'Cape Town',
        road: 'Main Road',
        houseNumber: '45',
        postalCode: '8005',
      });
      await geocodeOrConfirm(api, r, clientId, st.masterE, {
        ...STELLENBOSCH,
        city: 'Stellenbosch',
        road: 'Dorp Street',
        houseNumber: '1',
        postalCode: '7600',
      });
      const rawBody = '{}';
      const headers = opts.signingSecret ? signJob(opts.signingSecret, rawBody) : {};
      const res = await fetch(`${opts.baseUrl}/jobs/validate-master-locations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: rawBody,
      });
      const body = (await res.json()) as {
        attempted?: number;
        confirmed?: number;
        failed?: number;
        error?: string;
        message?: string;
      };
      r.note(`job → ${res.status} ${JSON.stringify(body)}`);
      r.expect(
        res.status === 200,
        opts.signingSecret
          ? 'webhook accepted the HMAC signature'
          : 'webhook accepted (server in dev bypass — set FLOWCATALYST_SIGNING_SECRET to exercise HMAC)',
      );
      const mD = await getMaster(api, clientId, st.masterD);
      const mE = await getMaster(api, clientId, st.masterE);
      r.expect(
        mD.status === 'VALIDATED' && mE.status === 'VALIDATED',
        'D and E are VALIDATED after the batch (or were already, via the operator path)',
      );
      const locE = await getLocation(api, clientId, st.locationE!);
      r.expect(
        locE.features.some((f) => f.featureLabel === 'Stellenbosch'),
        'E associated with the Stellenbosch radius feature',
      );
      const locD = await getLocation(api, clientId, st.locationD!);
      r.expect(
        locD.features.some((f) => f.featureLabel === 'Sea Point'),
        'D associated with the Sea Point radius feature',
      );
    },
  );

  await r.step('Spatial lookup + bulk match-features', async () => {
    const lookup = await ok(
      api.POST('/bff/clients/{clientId}/spatial-lookup', {
        params: { path: { clientId } },
        body: { latitude: STELLENBOSCH.lat, longitude: STELLENBOSCH.lon, partitionCode: 'default' },
      }),
    );
    r.note(
      `lookup at Stellenbosch → ${lookup.results.map((x) => `${x.layerCode}/${x.featureLabel} ${x.distanceMeters ?? '?'}m`).join(', ') || '(none)'}`,
    );
    r.expect(
      lookup.results.some((x) => x.featureLabel === 'Stellenbosch'),
      'spatial lookup finds the Stellenbosch feature',
    );
    const bulk = await ok(
      api.POST('/bff/clients/{clientId}/master-locations/match-features', {
        params: { path: { clientId } },
      }),
    );
    r.note(
      `bulk match-features → mastersProcessed=${bulk.mastersProcessed} totalAssociations=${bulk.totalAssociations}`,
    );
    r.expect(bulk.mastersProcessed >= 3, 'every geocoded master was (re)matched');
  });

  await r.step('Rematch E onto Sea Point (operator corrects the address)', async () => {
    if (!st.locationE || !st.masterD) throw new Error('no E/D');
    const res = await ok(
      api.POST('/bff/clients/{clientId}/locations/{locationId}/rematch', {
        params: { path: { clientId, locationId: st.locationE } },
        body: { matchAddress: '45 Main Road, Sea Point, Cape Town, 8005' },
      }),
    );
    r.note(`rematch → ${JSON.stringify(res)}`);
    const loc = await getLocation(api, clientId, st.locationE);
    r.expect(loc.masterLocationId === st.masterD, 'E now points at D’s master');
    r.expect(
      loc.features.some((f) => f.featureLabel === 'Sea Point'),
      'E carries the Sea Point association after rematch',
    );
  });

  await r.step(
    'Operator actions: edit master (→ PENDING), reject, layer partitions, feature status',
    async () => {
      if (!st.masterE) throw new Error('no master E');
      await ok(
        api.PUT('/bff/clients/{clientId}/master-locations/{masterLocationId}', {
          params: { path: { clientId, masterLocationId: st.masterE } },
          body: {
            houseNumber: '3',
            road: 'Dorp Street',
            city: 'Stellenbosch',
            postalCode: '7600',
            country: 'South Africa',
          },
        }),
      );
      const mE = await getMaster(api, clientId, st.masterE);
      r.expect(mE.status === 'PENDING', 'editing the address drops the master back to PENDING');
      try {
        await ok(
          api.POST('/clients/{clientId}/master-locations/{masterLocationId}/reject', {
            params: { path: { clientId, masterLocationId: st.masterE } },
            body: { reason: 'Walkthrough: operator rejected the edited master' },
          }),
        );
        const mE2 = await getMaster(api, clientId, st.masterE);
        r.expect(mE2.status === 'REJECTED', 'reject → REJECTED');
      } catch (err) {
        r.expect(false, `reject failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      await ok(
        api.PUT('/bff/clients/{clientId}/layers/{layerId}/partitions', {
          params: { path: { clientId, layerId: seeded.layerId } },
          body: { partitionIds: [seeded.westernCapePartitionId] },
        }),
      );
      const lookupDefault = await ok(
        api.POST('/bff/clients/{clientId}/spatial-lookup', {
          params: { path: { clientId } },
          body: { latitude: CBD.lat, longitude: CBD.lon, partitionCode: 'default' },
        }),
      );
      r.expect(
        lookupDefault.results.length === 0,
        'layer restricted to western-cape is invisible to the default partition',
      );
      await ok(
        api.PUT('/bff/clients/{clientId}/layers/{layerId}/partitions', {
          params: { path: { clientId, layerId: seeded.layerId } },
          body: { partitionIds: [] },
        }),
      );
      const f = await ok(
        api.PUT('/bff/clients/{clientId}/layers/{layerId}/features/{featureId}/status', {
          params: {
            path: { clientId, layerId: seeded.layerId, featureId: seeded.features.stellenbosch },
          },
          body: { status: 'INACTIVE' },
        }),
      );
      r.expect(f.status === 'INACTIVE', 'feature deactivated');
      const lookupStb = await ok(
        api.POST('/bff/clients/{clientId}/spatial-lookup', {
          params: { path: { clientId } },
          body: {
            latitude: STELLENBOSCH.lat,
            longitude: STELLENBOSCH.lon,
            partitionCode: 'default',
          },
        }),
      );
      r.expect(
        !lookupStb.results.some((x) => x.featureLabel === 'Stellenbosch'),
        'inactive feature is ignored by spatial lookup',
      );
      await ok(
        api.PUT('/bff/clients/{clientId}/layers/{layerId}/features/{featureId}/status', {
          params: {
            path: { clientId, layerId: seeded.layerId, featureId: seeded.features.stellenbosch },
          },
          body: { status: 'ACTIVE' },
        }),
      );
    },
  );

  await r.step('Authorization: a principal without permissions is refused', async () => {
    const { makeApi } = await import('./client.js');
    const nobody = makeApi(opts.baseUrl, 'prn_flows_nobody');
    // The dev-fallback identity grants ALL permissions to any x-user-id, so this
    // only exercises the 401 path: no identity at all.
    const anon = makeApi(opts.baseUrl, '');
    try {
      await ok(anon.GET('/bff/clients'));
      r.expect(false, 'anonymous request should be rejected');
    } catch (err) {
      r.expect(err instanceof ApiCallError && err.status === 401, 'anonymous request → 401');
    }
    void nobody;
  });

  return st;
}

export async function cleanup(api: Api, r: Report, seeded: Seeded, st: FlowState): Promise<void> {
  await r.step('Cleanup: delete what the walkthrough created', async () => {
    const { clientId } = seeded;
    for (const id of [st.locationA, st.locationB, st.locationC, st.locationD, st.locationE]) {
      if (!id) continue;
      try {
        await ok(
          api.DELETE('/bff/clients/{clientId}/locations/{locationId}', {
            params: { path: { clientId, locationId: id } },
          }),
        );
      } catch {
        /* already gone */
      }
    }
    for (const id of [st.masterA, st.masterD, st.masterE]) {
      if (!id) continue;
      try {
        await ok(
          api.DELETE('/bff/clients/{clientId}/master-locations/{masterLocationId}', {
            params: { path: { clientId, masterLocationId: id } },
          }),
        );
      } catch {
        /* already gone */
      }
    }
    try {
      await ok(
        api.DELETE('/bff/clients/{clientId}/layers/{layerId}', {
          params: { path: { clientId, layerId: seeded.layerId } },
        }),
      );
    } catch {
      /* ignore */
    }
    try {
      await ok(
        api.DELETE('/bff/clients/{clientId}/partitions/{partitionId}', {
          params: { path: { clientId, partitionId: seeded.westernCapePartitionId } },
        }),
      );
    } catch {
      /* ignore */
    }
    r.note(
      'client + default partition left in place (delete-client is canonical-API only); remove via the SPA if needed',
    );
  });
}
