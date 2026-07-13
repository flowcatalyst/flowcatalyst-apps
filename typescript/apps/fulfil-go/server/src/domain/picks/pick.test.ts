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

describe('Pick bag labels (docs/bag-label-printing.md)', () => {
  const mintFrom = (refs: string[]) => {
    let i = 0;
    return () => refs[i++]!;
  };

  it('setLabelCount allocates seq 1..count with fresh refs', () => {
    const claimed = Pick.claim(make(), 'pkr_abc', NOW);
    const pick = Pick.setLabelCount(claimed, 3, mintFrom(['pkg_a', 'pkg_b', 'pkg_c']), NOW);
    expect(pick.labels).toEqual({
      count: 3,
      labels: [
        { seq: 1, ref: 'pkg_a', reprints: 0 },
        { seq: 2, ref: 'pkg_b', reprints: 0 },
        { seq: 3, ref: 'pkg_c', reprints: 0 },
      ],
      voidedRefs: [],
    });
    expect(pick.version).toBe(claimed.version + 1);
  });

  it('replace GROW keeps kept refs (the trolley invariant) and extends', () => {
    const claimed = Pick.claim(make(), 'pkr_abc', NOW);
    const three = Pick.setLabelCount(claimed, 3, mintFrom(['pkg_a', 'pkg_b', 'pkg_c']), NOW);
    const five = Pick.setLabelCount(three, 5, mintFrom(['pkg_d', 'pkg_e']), NOW);
    expect(five.labels!.count).toBe(5);
    expect(five.labels!.labels.map((l) => l.ref)).toEqual([
      'pkg_a',
      'pkg_b',
      'pkg_c',
      'pkg_d',
      'pkg_e',
    ]);
    expect(five.labels!.voidedRefs).toEqual([]);
  });

  it('replace SHRINK voids dropped refs; re-grow mints FRESH refs for re-grown seqs', () => {
    const claimed = Pick.claim(make(), 'pkr_abc', NOW);
    const three = Pick.setLabelCount(claimed, 3, mintFrom(['pkg_a', 'pkg_b', 'pkg_c']), NOW);
    const two = Pick.setLabelCount(three, 2, mintFrom([]), NOW);
    expect(two.labels!.labels.map((l) => l.ref)).toEqual(['pkg_a', 'pkg_b']);
    expect(two.labels!.voidedRefs).toEqual(['pkg_c']);
    const threeAgain = Pick.setLabelCount(two, 3, mintFrom(['pkg_f']), NOW);
    expect(threeAgain.labels!.labels.map((l) => l.ref)).toEqual(['pkg_a', 'pkg_b', 'pkg_f']);
    // pkg_c stays voided forever — its physical label is lost.
    expect(threeAgain.labels!.voidedRefs).toEqual(['pkg_c']);
  });

  it('same count = re-render: every reprint counter bumps, refs stable', () => {
    const claimed = Pick.claim(make(), 'pkr_abc', NOW);
    const three = Pick.setLabelCount(claimed, 3, mintFrom(['pkg_a', 'pkg_b', 'pkg_c']), NOW);
    const again = Pick.setLabelCount(three, 3, mintFrom(['pkg_never']), NOW);
    expect(again.labels!.labels.map((l) => l.ref)).toEqual(['pkg_a', 'pkg_b', 'pkg_c']);
    expect(again.labels!.labels.every((l) => l.reprints === 1)).toBe(true);
    expect(again.version).toBe(three.version + 1);
  });

  it('recordLabelReprint bumps only that seq', () => {
    const claimed = Pick.claim(make(), 'pkr_abc', NOW);
    const three = Pick.setLabelCount(claimed, 3, mintFrom(['pkg_a', 'pkg_b', 'pkg_c']), NOW);
    const reprinted = Pick.recordLabelReprint(three, 2, NOW);
    expect(reprinted.labels!.labels.map((l) => l.reprints)).toEqual([0, 1, 0]);
    expect(reprinted.labels!.labels.map((l) => l.ref)).toEqual(['pkg_a', 'pkg_b', 'pkg_c']);
  });

  it('recordLabelReprint without an allocation throws (use-case guards first)', () => {
    const claimed = Pick.claim(make(), 'pkr_abc', NOW);
    expect(() => Pick.recordLabelReprint(claimed, 1, NOW)).toThrow(/no label allocation/);
  });
});
