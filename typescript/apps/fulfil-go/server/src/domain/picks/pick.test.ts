import { describe, expect, it } from 'vitest';
import { Pick } from './pick.js';
import type { PickId } from './ids.js';
import type { FulfilmentLine, OriginLocation } from '@fulfil-go/shared';

const NOW = new Date('2026-07-10T08:00:00Z');

const origin: OriginLocation = {
  ref: 'store-042',
  name: 'MetroFoods',
  address: { countryCode: 'ZA' },
};
const lines: FulfilmentLine[] = [
  {
    externalLineRef: 'L1',
    sku: 'SKU1',
    description: 'Milk 2L',
    quantity: 2,
    volumetric: { weightGrams: 2060 },
    temperatureClass: 'refrigerated',
  },
];

function make() {
  return Pick.create({
    id: 'pic_x' as PickId,
    clientId: 'cli_1',
    fulfilmentId: 'ful_1',
    partId: 'fpt_1',
    shortId: '1042',
    type: 'delivery',
    serviceLevel: 'ASAP',
    slotStart: NOW,
    slotEnd: new Date(NOW.getTime() + 3600_000),
    timezone: 'Africa/Johannesburg',
    origin,
    lines,
    requireFullPick: true,
    allowSubstitutes: false,
    releasedLate: false,
    now: NOW,
  });
}

describe('Pick', () => {
  it('creates requested with storeRef derived from origin.ref at version 1', () => {
    const pick = make();
    expect(pick.status).toBe('requested');
    expect(pick.storeRef).toBe('store-042');
    expect(pick.claimedBy).toBeNull();
    expect(pick.version).toBe(1);
  });

  it('claim sets picker + timestamps and bumps version', () => {
    const later = new Date(NOW.getTime() + 60_000);
    const claimed = Pick.claim(make(), 'pkr_abc', later);
    expect(claimed.status).toBe('claimed');
    expect(claimed.claimedBy).toBe('pkr_abc');
    expect(claimed.claimedAt).toEqual(later);
    expect(claimed.version).toBe(2);
    expect(claimed.updatedAt).toEqual(later);
  });
});
