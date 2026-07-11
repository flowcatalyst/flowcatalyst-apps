import { describe, expect, it } from 'vitest';
import { Fulfilment } from './fulfilment.js';
import type { FulfilmentId, FulfilmentPartId } from './ids.js';
import type { Destination, FulfilmentPolicies, OriginLocation } from '@fulfil-go/shared';

const NOW = new Date('2026-07-10T12:00:00Z');
const LATER = new Date('2026-07-10T12:05:00Z');

const origin = (ref: string): OriginLocation => ({ ref, address: { countryCode: 'ZA' } });
const destination: Destination = {
  kind: 'delivery',
  location: { address: { countryCode: 'ZA' } },
};

function make(policies: Partial<FulfilmentPolicies> = {}) {
  const f = Fulfilment.create({
    id: 'ful_x' as FulfilmentId,
    clientId: 'cli_1',
    externalSource: 'test',
    externalRef: 'T1',
    type: 'delivery',
    serviceLevel: 'ASAP',
    slotStart: NOW,
    slotEnd: LATER,
    timezone: 'Africa/Johannesburg',
    destination,
    policies: { allowSubstitutes: true, allowPartialFulfilment: true, ...policies },
    provenance: null,
    additionalData: null,
    parts: [
      {
        id: 'fpt_a' as FulfilmentPartId,
        shortId: '1001',
        releaseAt: NOW,
        origin: origin('store-1'),
        lines: [],
      },
      {
        id: 'fpt_b' as FulfilmentPartId,
        shortId: '1002',
        releaseAt: NOW,
        origin: origin('store-2'),
        lines: [],
      },
    ],
    now: NOW,
  });
  // Release both parts (created → in_progress, parts → pick_requested).
  let released = Fulfilment.releasePart(f, 'fpt_a' as FulfilmentPartId, NOW);
  released = Fulfilment.releasePart(released, 'fpt_b' as FulfilmentPartId, NOW);
  return released;
}

const partStatus = (f: ReturnType<typeof make>, id: string) =>
  f.parts.find((p) => p.id === id)?.status;

const ACTUALS = { lineResults: [], packages: [], requiresVehicle: false };

describe('Fulfilment pick-progress transitions', () => {
  it('partPicking: pick_requested → picking, one version bump', () => {
    const f = make();
    const v = f.version;
    const next = Fulfilment.partPicking(f, 'fpt_a' as FulfilmentPartId, LATER);
    expect(partStatus(next, 'fpt_a')).toBe('picking');
    expect(partStatus(next, 'fpt_b')).toBe('pick_requested');
    expect(next.status).toBe('in_progress');
    expect(next.version).toBe(v + 1);
  });

  it('partPickOutcome short → short_picked', () => {
    const f = Fulfilment.partPicking(make(), 'fpt_a' as FulfilmentPartId, LATER);
    const next = Fulfilment.partPickOutcome(f, 'fpt_a' as FulfilmentPartId, true, ACTUALS, LATER);
    expect(partStatus(next, 'fpt_a')).toBe('short_picked');
  });

  it('allViablePicked only when every viable part is picked', () => {
    let f = make();
    f = Fulfilment.partPickOutcome(f, 'fpt_a' as FulfilmentPartId, false, ACTUALS, LATER);
    expect(Fulfilment.allViablePicked(f)).toBe(false);
    f = Fulfilment.partPickOutcome(f, 'fpt_b' as FulfilmentPartId, true, ACTUALS, LATER);
    expect(Fulfilment.allViablePicked(f)).toBe(true);
  });

  it('a failed part drops out of viability — remaining picked ⇒ allViablePicked', () => {
    let f = make();
    f = Fulfilment.partPickOutcome(f, 'fpt_a' as FulfilmentPartId, false, ACTUALS, LATER);
    f = Fulfilment.partFailed(f, 'fpt_b' as FulfilmentPartId, LATER);
    expect(Fulfilment.allViablePicked(f)).toBe(true);
    expect(Fulfilment.viableParts(f)).toHaveLength(1);
  });

  it('markReady composes WITHOUT a second version bump', () => {
    let f = make();
    f = Fulfilment.partPickOutcome(f, 'fpt_a' as FulfilmentPartId, false, ACTUALS, LATER);
    const v = f.version;
    let next = Fulfilment.partPickOutcome(f, 'fpt_b' as FulfilmentPartId, false, ACTUALS, LATER);
    next = Fulfilment.markReady(next, LATER);
    expect(next.status).toBe('ready');
    expect(next.version).toBe(v + 1); // exactly one bump for the whole commit
  });

  it('failFulfilment cancels in-play parts but leaves the failed part failed', () => {
    let f = make();
    f = Fulfilment.partFailed(f, 'fpt_a' as FulfilmentPartId, LATER);
    const v = f.version;
    const next = Fulfilment.failFulfilment(f, LATER);
    expect(next.status).toBe('failed');
    expect(partStatus(next, 'fpt_a')).toBe('failed');
    expect(partStatus(next, 'fpt_b')).toBe('cancelled');
    expect(next.version).toBe(v); // composes — no bump of its own
  });
});
