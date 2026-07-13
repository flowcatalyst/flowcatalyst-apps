import { describe, expect, it } from 'vitest';
import { sortPickLines, type FulfilmentLineLocation } from '@fulfil-go/shared';

/** Minimal sortable line — `ref` identifies expectations. */
type TestLine = {
  ref: string;
  location?: Partial<FulfilmentLineLocation>;
  attributes?: Record<string, string>;
  temperatureClass?: string;
};

const refs = (lines: readonly TestLine[]): string[] => lines.map((l) => l.ref);

describe('sortPickLines', () => {
  it('as-received preserves upstream order and returns a NEW array', () => {
    const input: TestLine[] = [
      { ref: 'c', location: { aisle: 'A9' } },
      { ref: 'a', location: { aisle: 'A1' } },
      { ref: 'b' },
    ];
    const out = sortPickLines(input, 'as-received');
    expect(refs(out)).toEqual(['c', 'a', 'b']);
    expect(out).not.toBe(input);
  });

  it('never mutates the input array', () => {
    const input: TestLine[] = [
      { ref: 'b', location: { aisle: 'A2' } },
      { ref: 'a', location: { aisle: 'A1' } },
    ];
    sortPickLines(input, 'walk-sequence');
    expect(refs(input)).toEqual(['b', 'a']);
  });

  it('walk-sequence orders by walkSequence first, nulls LAST', () => {
    const out = sortPickLines<TestLine>(
      [
        { ref: 'no-seq', location: { aisle: 'A1' } },
        { ref: 'late', location: { walkSequence: 40, aisle: 'A9' } },
        { ref: 'early', location: { walkSequence: 2, aisle: 'A9' } },
      ],
      'walk-sequence',
    );
    expect(refs(out)).toEqual(['early', 'late', 'no-seq']);
  });

  it('walk-sequence degrades to aisle→bay→shelf→positionIndex when no walkSequence', () => {
    const out = sortPickLines<TestLine>(
      [
        { ref: 'p2', location: { aisle: 'A1', bay: 'B1', shelf: '1', positionIndex: 2 } },
        { ref: 'p1', location: { aisle: 'A1', bay: 'B1', shelf: '1', positionIndex: 1 } },
        { ref: 's2', location: { aisle: 'A1', bay: 'B1', shelf: '2' } },
        { ref: 'b2', location: { aisle: 'A1', bay: 'B2' } },
        { ref: 'a2', location: { aisle: 'A2' } },
      ],
      'walk-sequence',
    );
    expect(refs(out)).toEqual(['p1', 'p2', 's2', 'b2', 'a2']);
  });

  it('uses NATURAL string order: A2 before A10, B3 before B12; missing bay sinks LAST in its aisle', () => {
    const out = sortPickLines<TestLine>(
      [
        { ref: 'a10', location: { aisle: 'A10' } },
        { ref: 'a2', location: { aisle: 'A2' } },
        { ref: 'a2b12', location: { aisle: 'A2', bay: 'B12' } },
        { ref: 'a2b3', location: { aisle: 'A2', bay: 'B3' } },
      ],
      'aisle-bay-shelf',
    );
    // Nulls sort LAST at EVERY tier (walkSequence, aisle, bay, shelf,
    // positionIndex alike) — missing data sinks within its group.
    expect(refs(out)).toEqual(['a2b3', 'a2b12', 'a2', 'a10']);
  });

  it('sorts lines without any location data LAST', () => {
    const out = sortPickLines<TestLine>(
      [{ ref: 'bare' }, { ref: 'located', location: { aisle: 'A5' } }],
      'walk-sequence',
    );
    expect(refs(out)).toEqual(['located', 'bare']);
  });

  it('is STABLE: equal keys keep original relative order', () => {
    const out = sortPickLines<TestLine>(
      [
        { ref: 'x1', location: { aisle: 'A3' } },
        { ref: 'x2', location: { aisle: 'A3' } },
        { ref: 'first', location: { aisle: 'A1' } },
        { ref: 'x3', location: { aisle: 'A3' } },
      ],
      'aisle-bay-shelf',
    );
    expect(refs(out)).toEqual(['first', 'x1', 'x2', 'x3']);
  });

  it('aisle-bay-shelf IGNORES walkSequence', () => {
    const out = sortPickLines<TestLine>(
      [
        { ref: 'seq-first', location: { walkSequence: 1, aisle: 'A9' } },
        { ref: 'aisle-first', location: { walkSequence: 99, aisle: 'A1' } },
      ],
      'aisle-bay-shelf',
    );
    expect(refs(out)).toEqual(['aisle-first', 'seq-first']);
  });

  it("falls back to legacy attributes.aisle when a line has no location (today's behaviour)", () => {
    const out = sortPickLines<TestLine>(
      [
        { ref: 'legacy-late', attributes: { aisle: 'A08·B3' } },
        { ref: 'legacy-early', attributes: { aisle: 'A02·B1' } },
        { ref: 'located', location: { aisle: 'A05' } },
        { ref: 'bare' },
      ],
      'walk-sequence',
    );
    expect(refs(out)).toEqual(['legacy-early', 'located', 'legacy-late', 'bare']);
  });

  it('temperature-zone bands ambient → chilled → frozen → hot, walk order within a band', () => {
    const out = sortPickLines<TestLine>(
      [
        { ref: 'hot', temperatureClass: 'hot', location: { walkSequence: 1 } },
        { ref: 'frozen', temperatureClass: 'frozen', location: { walkSequence: 2 } },
        { ref: 'ambient-late', temperatureClass: 'ambient', location: { walkSequence: 9 } },
        { ref: 'chilled', temperatureClass: 'chilled', location: { walkSequence: 3 } },
        { ref: 'ambient-early', temperatureClass: 'ambient', location: { walkSequence: 4 } },
      ],
      'temperature-zone',
    );
    expect(refs(out)).toEqual(['ambient-early', 'ambient-late', 'chilled', 'frozen', 'hot']);
  });

  it('temperature-zone treats a missing/unknown class as ambient (never pushed to the end)', () => {
    const out = sortPickLines<TestLine>(
      [
        { ref: 'frozen', temperatureClass: 'frozen', location: { walkSequence: 1 } },
        { ref: 'unclassified', location: { walkSequence: 2 } },
        { ref: 'weird', temperatureClass: 'lava', location: { walkSequence: 3 } },
      ],
      'temperature-zone',
    );
    expect(refs(out)).toEqual(['unclassified', 'weird', 'frozen']);
  });
});
