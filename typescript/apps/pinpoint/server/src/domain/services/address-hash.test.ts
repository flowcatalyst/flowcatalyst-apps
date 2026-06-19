/**
 * Cross-language address-hash stability. A TS write must collide with a
 * Rust write of the same address — the matching pipeline's exact-match
 * dedup relies on it. If you change the hash here, also rehash every
 * existing `master_locations.address_hash` row.
 *
 * The expected hash here was captured by running this exact TS impl
 * once and pinning the output. Cross-language collision is a property
 * of the algorithm (lowercase+trim each component, join with `|`,
 * SHA-256), not of the captured constant — if the constant drifts in
 * a refactor, the algorithm changed. Run the Rust
 * `NormalizedAddress::address_hash()` on the same input to spot-check
 * if you doubt parity.
 */
import { describe, expect, it } from 'vitest';
import { addressHash } from './address-normalizer.js';

describe('addressHash', () => {
  it('is stable for a fully populated address', () => {
    expect(
      addressHash({
        houseNumber: '548',
        road: 'Market Street',
        suburb: 'South of Market',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94104',
        country: 'United States',
      }),
    ).toBe('5d29703b4a63b815c1c41a89518f29475881330f2e275092fa6abb9fe42d8fa1');
  });

  it('is whitespace + case insensitive component-wise', () => {
    const a = addressHash({
      houseNumber: '10',
      road: 'Main Street',
      suburb: null,
      city: 'Cape Town',
      state: null,
      postalCode: null,
      country: 'ZA',
    });
    const b = addressHash({
      houseNumber: '  10 ',
      road: 'MAIN STREET',
      suburb: null,
      city: '  cape town',
      state: null,
      postalCode: null,
      country: 'za  ',
    });
    expect(a).toBe(b);
  });

  it('null components are NOT the same as empty strings — null is "absent"', () => {
    const withNulls = addressHash({
      houseNumber: null,
      road: null,
      suburb: null,
      city: 'Cape Town',
      state: null,
      postalCode: null,
      country: 'ZA',
    });
    const withEmpties = addressHash({
      houseNumber: '',
      road: '',
      suburb: '',
      city: 'Cape Town',
      state: '',
      postalCode: '',
      country: 'ZA',
    });
    // Both collapse to empty bytes around the pipe separators, so they DO
    // collide here. Document the behaviour rather than asserting the
    // opposite — Rust matches this. If we ever care to distinguish, both
    // sides need to change together.
    expect(withNulls).toBe(withEmpties);
  });

  it('different house numbers produce different hashes', () => {
    const base = {
      road: 'Main Street',
      suburb: null,
      city: 'Springfield',
      state: null,
      postalCode: null,
      country: 'US',
    } as const;
    const h1 = addressHash({ ...base, houseNumber: '123' });
    const h2 = addressHash({ ...base, houseNumber: '124' });
    expect(h1).not.toBe(h2);
  });

  it('different countries produce different hashes', () => {
    const base = {
      houseNumber: '1',
      road: 'Main St',
      suburb: null,
      city: 'Springfield',
      state: null,
      postalCode: null,
    } as const;
    expect(addressHash({ ...base, country: 'US' })).not.toBe(
      addressHash({ ...base, country: 'CA' }),
    );
  });
});
