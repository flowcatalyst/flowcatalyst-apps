/**
 * `toAddressLine` is what the pg_trgm fuzzy index will hash in Slice 8, so
 * stability across releases matters — any change to the order or
 * separators here silently invalidates existing trigram indexes. These
 * tests pin the exact Rust-compatible output shape.
 */
import { describe, expect, it } from 'vitest';
import { toAddressLine, type NormalizedAddress } from './address-normalizer.js';

function addr(overrides: Partial<NormalizedAddress> = {}): NormalizedAddress {
  return {
    houseNumber: null,
    road: null,
    suburb: null,
    city: 'Cape Town',
    state: null,
    postalCode: null,
    country: 'ZA',
    ...overrides,
  };
}

describe('toAddressLine', () => {
  it('joins street + suburb + city + country in order', () => {
    expect(toAddressLine(addr({ houseNumber: '12', road: 'Main St', suburb: 'Camps Bay' }))).toBe(
      '12 Main St, Camps Bay, Cape Town, ZA',
    );
  });

  it('omits street when neither houseNumber nor road is present', () => {
    expect(toAddressLine(addr())).toBe('Cape Town, ZA');
  });

  it('keeps the street segment even when only houseNumber is known', () => {
    expect(toAddressLine(addr({ houseNumber: '17' }))).toBe('17, Cape Town, ZA');
  });

  it('keeps the street segment even when only road is known', () => {
    expect(toAddressLine(addr({ road: 'Bree St' }))).toBe('Bree St, Cape Town, ZA');
  });

  it('includes suburb between street and city when present', () => {
    expect(toAddressLine(addr({ road: 'Bree St', suburb: 'CBD' }))).toBe(
      'Bree St, CBD, Cape Town, ZA',
    );
  });

  it('drops state and postalCode — they are not part of the trigram key', () => {
    const line = toAddressLine(
      addr({ road: 'Bree St', state: 'Western Cape', postalCode: '8001' }),
    );
    expect(line).not.toContain('Western Cape');
    expect(line).not.toContain('8001');
  });
});
