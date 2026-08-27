/**
 * `toAddressLine` is what the pg_trgm fuzzy index will hash in Slice 8, so
 * stability across releases matters — any change to the order or
 * separators here silently invalidates existing trigram indexes. These
 * tests pin the exact Rust-compatible output shape.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeWithFallback,
  toAddressLine,
  type AddressNormalizer,
  type NormalizedAddress,
  type NormalizeOptions,
} from './address-normalizer.js';

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

/**
 * The fallback ladder is shared by `create-location` (ingest) and
 * `/geocode/address` (diagnostic). If the two ever parse the same line
 * differently, `addressHash` stops agreeing with itself — hence one
 * implementation with the behaviour pinned here.
 */
describe('normalizeWithFallback', () => {
  const parsed = addr({ road: 'Bree St' });

  function normalizer(
    impl: (address: string, options?: NormalizeOptions) => Promise<NormalizedAddress>,
  ): AddressNormalizer {
    return { normalize: impl };
  }

  it('returns the strict parse when the first attempt succeeds', async () => {
    const calls: string[] = [];
    const result = await normalizeWithFallback(
      normalizer(async (a) => {
        calls.push(a);
        return parsed;
      }),
      'Bree St, Cape Town',
      'ZAF',
    );

    expect(result).toEqual({ normalized: parsed, bestEffort: false });
    // The country hint is only for retries — an address that parses cleanly
    // must not be mutated.
    expect(calls).toEqual(['Bree St, Cape Town']);
  });

  it('retries the strict parse with the country code appended', async () => {
    const calls: string[] = [];
    const result = await normalizeWithFallback(
      normalizer(async (a) => {
        calls.push(a);
        if (!a.endsWith('ZAF')) throw new Error('cannot identify country');
        return parsed;
      }),
      'Bree St',
      'ZAF',
    );

    expect(result).toEqual({ normalized: parsed, bestEffort: false });
    expect(calls).toEqual(['Bree St', 'Bree St, ZAF']);
  });

  it('skips the hint retry and goes straight to best-effort when no country code is given', async () => {
    const calls: { address: string; strict: boolean }[] = [];
    const result = await normalizeWithFallback(
      normalizer(async (a, o) => {
        calls.push({ address: a, strict: o?.strict !== false });
        if (o?.strict !== false) throw new Error('cannot identify city');
        return parsed;
      }),
      'somewhere vague',
      null,
    );

    expect(result).toEqual({ normalized: parsed, bestEffort: true });
    expect(calls).toEqual([
      { address: 'somewhere vague', strict: true },
      { address: 'somewhere vague', strict: false },
    ]);
  });

  it('flags a best-effort parse after both strict attempts fail', async () => {
    const result = await normalizeWithFallback(
      normalizer(async (_a, o) => {
        if (o?.strict !== false) throw new Error('cannot identify city');
        return parsed;
      }),
      'somewhere vague',
      'ZAF',
    );

    expect(result.bestEffort).toBe(true);
  });

  it('propagates the failure when even best-effort fails — libpostal is down', async () => {
    await expect(
      normalizeWithFallback(
        normalizer(async () => {
          throw new Error('libpostal unreachable');
        }),
        'Bree St',
        'ZAF',
      ),
    ).rejects.toThrow('libpostal unreachable');
  });
});
