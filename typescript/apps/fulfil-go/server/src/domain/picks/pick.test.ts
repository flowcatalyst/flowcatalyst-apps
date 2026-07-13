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
    temperatureClass: 'chilled',
  },
  {
    externalLineRef: 'L2',
    sku: 'SKU2',
    description: 'Bread',
    quantity: 3,
    volumetric: { weightGrams: 700 },
    temperatureClass: 'ambient',
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
    sortAlgorithm: 'walk-sequence',
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

  it('complete with all quantities full → picked', () => {
    const claimed = Pick.claim(make(), 'pkr_abc', NOW);
    const done = Pick.complete(
      claimed,
      [
        { externalLineRef: 'L1', pickedQuantity: 2 },
        { externalLineRef: 'L2', pickedQuantity: 3 },
      ],
      null,
      false,
      NOW,
    );
    expect(done.status).toBe('picked');
    expect(done.lineResults).toHaveLength(2);
    expect(done.packages).toBeNull();
    expect(done.completedAt).toEqual(NOW);
    expect(done.version).toBe(3);
  });

  it('complete with any line short → short_picked', () => {
    const claimed = Pick.claim(make(), 'pkr_abc', NOW);
    const done = Pick.complete(
      claimed,
      [
        { externalLineRef: 'L1', pickedQuantity: 2 },
        { externalLineRef: 'L2', pickedQuantity: 1 },
      ],
      null,
      false,
      NOW,
    );
    expect(done.status).toBe('short_picked');
  });

  it('complete records packaging (bags + loose)', () => {
    const claimed = Pick.claim(make(), 'pkr_abc', NOW);
    const done = Pick.complete(
      claimed,
      [
        { externalLineRef: 'L1', pickedQuantity: 2 },
        { externalLineRef: 'L2', pickedQuantity: 3 },
      ],
      [
        {
          ref: 'BAG-001',
          kind: 'bag',
          size: 'M',
          temperature: 'chilled',
          items: [{ externalLineRef: 'L1', quantity: 2 }],
        },
        {
          ref: 'loose-1',
          kind: 'loose',
          size: null,
          temperature: 'ambient',
          items: [{ externalLineRef: 'L2', quantity: 3 }],
        },
      ],
      true,
      NOW,
    );
    expect(done.status).toBe('picked');
    expect(done.requiresVehicle).toBe(true);
    expect(done.packages).toHaveLength(2);
    expect(done.packages?.[0]?.size).toBe('M');
    expect(done.packages?.[1]?.kind).toBe('loose');
  });

  it('a missing line result reads as not-full', () => {
    const claimed = Pick.claim(make(), 'pkr_abc', NOW);
    expect(Pick.isFullPick(claimed, [{ externalLineRef: 'L1', pickedQuantity: 2 }])).toBe(false);
  });

  it('substituted units count toward fullness', () => {
    const claimed = Pick.claim(make(), 'pkr_abc', NOW);
    const results = [
      {
        externalLineRef: 'L1',
        pickedQuantity: 1,
        substitutions: [{ barcode: '600123', description: 'Other milk', quantity: 1 }],
      },
      { externalLineRef: 'L2', pickedQuantity: 3 },
    ];
    expect(Pick.isFullPick(claimed, results)).toBe(true);
    const done = Pick.complete(claimed, results, null, false, NOW);
    expect(done.status).toBe('picked');
    expect(done.lineResults?.[0]?.substitutions?.[0]?.barcode).toBe('600123');
  });

  it('fail records the reason', () => {
    const claimed = Pick.claim(make(), 'pkr_abc', NOW);
    const failed = Pick.fail(claimed, 'Out of stock', NOW);
    expect(failed.status).toBe('failed');
    expect(failed.failReason).toBe('Out of stock');
    expect(failed.completedAt).toEqual(NOW);
    expect(failed.version).toBe(3);
  });
});
