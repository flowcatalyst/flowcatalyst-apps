/**
 * AddressMatcher tests. Port of the Rust unit-test trio
 * (`test_exact_hash_match`, `test_substitution_matching`,
 * `test_no_match_different_house_number`) plus a few extras that pin the
 * substitution table + JW similarity behaviour.
 *
 * Why pin the algorithm output: changing matcher behaviour silently
 * changes which master locations a fresh location matches against —
 * effectively a schema migration on every dataset that's been tuned
 * against the existing thresholds. Pinning here means a future "small
 * cleanup" PR can't sneak through.
 */
import { describe, expect, it } from 'vitest';
import { MATCHING_CONFIG_DEFAULTS } from '../matching/matching-config.js';
import type { MasterLocation } from '../locations/master-location.js';
import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { MasterLocationId } from '../locations/ids.js';
import { findMatch, __internal } from './address-matcher.js';

const CLIENT = 'cli_test' as ClientId;
const PARTITION = null as PartitionId | null;
const NOW = new Date('2026-01-01T00:00:00Z');

function master(overrides: Partial<MasterLocation> = {}): MasterLocation {
  return {
    id: 'mlo_default' as MasterLocationId,
    clientId: CLIENT,
    partitionId: PARTITION,
    normalizedHouseNumber: null,
    normalizedRoad: null,
    normalizedSuburb: null,
    normalizedCity: 'Cape Town',
    normalizedState: null,
    normalizedPostalCode: null,
    normalizedCountry: 'south africa',
    addressHash: 'irrelevant',
    normalizedAddressLine: null,
    latitude: null,
    longitude: null,
    status: 'VALIDATED',
    createdAt: NOW,
    updatedAt: NOW,
    validatedAt: NOW,
    ...overrides,
  };
}

describe('findMatch', () => {
  it('returns EXACT_HASH with confidence=1 when input hash matches a candidate', () => {
    const candidates = [master({ id: 'mlo_1' as MasterLocationId, addressHash: 'exact' })];
    const result = findMatch(
      {
        houseNumber: '123',
        road: 'Main St',
        suburb: null,
        city: 'Springfield',
        state: null,
        postalCode: null,
        country: 'US',
      },
      'exact',
      candidates,
      MATCHING_CONFIG_DEFAULTS,
    );
    expect(result).toEqual({
      masterLocationId: 'mlo_1',
      confidence: 1,
      method: 'EXACT_HASH',
    });
  });

  it('uses substitutions so "Joburg" + "Straat" + "ZAF" match "Johannesburg" + "Street" + "south africa"', () => {
    const candidates = [
      master({
        id: 'mlo_1' as MasterLocationId,
        normalizedHouseNumber: '10',
        normalizedRoad: 'Main Street',
        normalizedCity: 'Johannesburg',
        normalizedCountry: 'south africa',
      }),
    ];
    const result = findMatch(
      {
        houseNumber: '10',
        road: 'Main Straat',
        suburb: null,
        city: 'Joburg',
        state: null,
        postalCode: null,
        country: 'ZAF',
      },
      'no_match',
      candidates,
      MATCHING_CONFIG_DEFAULTS,
    );
    expect(result).not.toBeNull();
    expect(result!.method).toBe('FUZZY');
    expect(result!.confidence).toBeGreaterThan(0.85);
  });

  it('rejects fuzzy matches where house_number differs (config gates this hard)', () => {
    const candidates = [
      master({
        id: 'mlo_1' as MasterLocationId,
        normalizedHouseNumber: '456',
        normalizedRoad: 'Main St',
        normalizedCity: 'Springfield',
        normalizedCountry: 'US',
        addressHash: 'other',
      }),
    ];
    const result = findMatch(
      {
        houseNumber: '123',
        road: 'Main St',
        suburb: null,
        city: 'Springfield',
        state: null,
        postalCode: null,
        country: 'US',
      },
      'no_match',
      candidates,
      MATCHING_CONFIG_DEFAULTS,
    );
    expect(result).toBeNull();
  });

  it('returns null when there are no candidates', () => {
    const result = findMatch(
      {
        houseNumber: '1',
        road: 'Test',
        suburb: null,
        city: 'Nowhere',
        state: null,
        postalCode: null,
        country: 'ZA',
      },
      'h',
      [],
      MATCHING_CONFIG_DEFAULTS,
    );
    expect(result).toBeNull();
  });

  it('picks the candidate with the highest overall score when several pass thresholds', () => {
    const candidates = [
      master({
        id: 'mlo_lower' as MasterLocationId,
        addressHash: 'a',
        normalizedHouseNumber: '10',
        normalizedRoad: 'Main Street',
        normalizedCity: 'Cape Town',
        normalizedPostalCode: '8001',
        normalizedCountry: 'south africa',
      }),
      master({
        id: 'mlo_higher' as MasterLocationId,
        addressHash: 'b',
        normalizedHouseNumber: '10',
        normalizedRoad: 'Main Street',
        normalizedCity: 'Cape Town',
        normalizedPostalCode: '8000', // exact match
        normalizedCountry: 'south africa',
      }),
    ];
    const result = findMatch(
      {
        houseNumber: '10',
        road: 'Main Street',
        suburb: null,
        city: 'Cape Town',
        state: null,
        postalCode: '8000',
        country: 'south africa',
      },
      'no_match',
      candidates,
      MATCHING_CONFIG_DEFAULTS,
    );
    expect(result).not.toBeNull();
    expect(result!.masterLocationId).toBe('mlo_higher');
  });
});

describe('jaroWinkler', () => {
  // Spot-checks chosen so the same inputs run through Rust strsim::jaro_winkler
  // give the same numbers — keeps the algorithm port honest. Tolerance is
  // generous because Rust's impl uses f64 and ours uses JS number; the bit
  // patterns line up but rounding can differ in the last 1-2 digits.
  it('returns 1 for identical strings', () => {
    expect(__internal.jaroWinkler('hello', 'hello')).toBe(1);
  });

  it('returns 0 when both inputs are empty (matches Rust convention)', () => {
    expect(__internal.jaroWinkler('', 'abc')).toBe(0);
    expect(__internal.jaroWinkler('abc', '')).toBe(0);
  });

  it('boosts strings with a common prefix', () => {
    // "MARTHA" / "MARHTA" — the canonical Jaro-Winkler example.
    expect(__internal.jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 2);
  });

  it('handles unicode via per-code-unit comparison (not grapheme-aware)', () => {
    // Single trailing-char difference. We deliberately stick with the same
    // per-code-unit comparison Rust strsim uses for `&str` so the matcher's
    // numerical output stays the same across both backends — same input
    // bytes in, same number out. Don't switch to grapheme-aware compare
    // without re-tuning the thresholds in MatchingConfig.
    expect(__internal.jaroWinkler('café', 'cafe')).toBeGreaterThan(0.85);
  });
});

describe('substitution tables', () => {
  it('per-word substitution: bare entries match after the alphanumeric trim', () => {
    expect(__internal.applySubstitutions('Main Rd')).toBe('main road');
    expect(__internal.applySubstitutions('Main Straat')).toBe('main street');
    expect(__internal.applySubstitutions('Main Ave')).toBe('main avenue');
  });

  it('per-word substitution: "Main St." stays as-is because Rust SUBSTITUTIONS lacks a bare "st" entry', () => {
    // After the non-alphanumeric trim, 'st.' becomes 'st' — but the Rust
    // SUBSTITUTIONS table only has 'st.' (with the dot), not bare 'st'.
    // So "Main St." round-trips unchanged. Pinpoint-rs has the same quirk;
    // tracked here so a future "obvious cleanup" PR can't sneak through
    // without also fixing the Rust side + re-tuning thresholds.
    expect(__internal.applySubstitutions('Main St.')).toBe('main st.');
    // Conversely, the dot-suffixed-only entries DO sub when the dot is
    // present in the original input (the trim sees the bare form).
    expect(__internal.applySubstitutions('Main Rd.')).toBe('main road');
  });

  it('full-value substitution maps ZA city aliases', () => {
    expect(__internal.applyFullSubstitution('Joburg')).toBe('johannesburg');
    expect(__internal.applyFullSubstitution(' JHB ')).toBe('johannesburg');
    expect(__internal.applyFullSubstitution('Gqeberha')).toBe('port elizabeth');
  });

  it('full-value substitution maps country codes', () => {
    expect(__internal.applyFullSubstitution('ZA')).toBe('south africa');
    expect(__internal.applyFullSubstitution('ZAF')).toBe('south africa');
    expect(__internal.applyFullSubstitution('US')).toBe('united states');
  });

  it('returns the input lowercase-trimmed when no substitution applies', () => {
    expect(__internal.applyFullSubstitution(' Random ')).toBe('random');
    expect(__internal.applySubstitutions('Random Street')).toBe('random street');
  });
});
