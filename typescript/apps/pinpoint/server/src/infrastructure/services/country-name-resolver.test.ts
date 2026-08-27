/**
 * Guards the fix for the self-hosted-Photon country mismatch: our index matches
 * country NAMES, so an ISO token (`zaf`, `za`) has to be widened before it
 * reaches the geocoder, while anything that is already a name passes through.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Country } from '../../domain/reference/country.js';
import type { CountryRepository } from '../../domain/reference/country.repository.js';
import { createCountryNameResolver } from './country-name-resolver.js';

const COUNTRIES: Country[] = [
  { id: 1, name: 'South Africa', isoA2: 'ZA', isoA3: 'ZAF' },
  { id: 2, name: 'United States', isoA2: 'US', isoA3: 'USA' },
];

function repo(overrides: Partial<CountryRepository> = {}): CountryRepository {
  return {
    listAll: vi.fn().mockResolvedValue(COUNTRIES),
    findByIsoA2: vi.fn().mockResolvedValue(null),
    findByIsoA3: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('createCountryNameResolver', () => {
  it('widens an ISO-A3 code to the country name', async () => {
    const resolve = createCountryNameResolver(repo());
    expect(await resolve('zaf')).toBe('South Africa');
  });

  it('widens an ISO-A2 code to the country name', async () => {
    const resolve = createCountryNameResolver(repo());
    expect(await resolve('za')).toBe('South Africa');
  });

  it('is case- and whitespace-insensitive', async () => {
    const resolve = createCountryNameResolver(repo());
    expect(await resolve('  ZAF ')).toBe('South Africa');
  });

  it('returns null for a value that is already a name, so it passes through', async () => {
    const resolve = createCountryNameResolver(repo());
    expect(await resolve('south africa')).toBeNull();
  });

  it('returns null for an unknown code rather than inventing one', async () => {
    const resolve = createCountryNameResolver(repo());
    expect(await resolve('xyz')).toBeNull();
  });

  it('reads the table once across many lookups', async () => {
    const r = repo();
    const resolve = createCountryNameResolver(r);
    await Promise.all([resolve('za'), resolve('usa'), resolve('zaf')]);
    await resolve('us');
    expect(r.listAll).toHaveBeenCalledTimes(1);
  });

  it('degrades to null when the reference lookup fails — never blocks a geocode', async () => {
    const r = repo({ listAll: vi.fn().mockRejectedValue(new Error('db down')) });
    const resolve = createCountryNameResolver(r);
    expect(await resolve('zaf')).toBeNull();
  });

  it('retries after a failure instead of caching the error forever', async () => {
    const listAll = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(COUNTRIES);
    const resolve = createCountryNameResolver(repo({ listAll }));

    expect(await resolve('zaf')).toBeNull();
    expect(await resolve('zaf')).toBe('South Africa');
  });
});
