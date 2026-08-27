/**
 * Resolves an ISO 3166-1 country code to the country's display name, backed by
 * the seeded `countries` reference table.
 *
 * Why this exists: our self-hosted Photon index only matches country *names*.
 * A query ending `…, randburg, zaf` (or `…, za`) returns zero features, while
 * `…, randburg, south africa` matches. The public photon.komoot.io instance
 * happily matches all three, so this only bites against self-hosted indexes —
 * which made it an unpleasant one to track down.
 *
 * libpostal echoes back whatever country token it was given, so an address
 * ingested with `countryCode: "ZAF"` stores `normalizedCountry = "zaf"` and
 * would otherwise never geocode.
 *
 * This deliberately converts at QUERY time only. `normalizedCountry` is part of
 * `addressHash`, which must stay byte-compatible with the Rust pinpoint, so
 * rewriting stored components would break exact-match dedup across both
 * implementations. The stored value keeps libpostal's output; only the string
 * handed to the geocoder is widened.
 *
 * The table is read once and memoized — 177 static rows that never change
 * within a process lifetime.
 */
import type { CountryRepository } from '../../domain/reference/country.repository.js';

export type CountryNameResolver = (country: string) => Promise<string | null>;

export function createCountryNameResolver(countries: CountryRepository): CountryNameResolver {
  let cache: Promise<Map<string, string>> | null = null;

  function load(): Promise<Map<string, string>> {
    // Cache the promise, not the value, so concurrent first calls share one read.
    cache ??= countries.listAll().then((list) => {
      const byCode = new Map<string, string>();
      for (const c of list) {
        byCode.set(c.isoA2.toLowerCase(), c.name);
        byCode.set(c.isoA3.toLowerCase(), c.name);
      }
      return byCode;
    });
    return cache;
  }

  return async (country: string): Promise<string | null> => {
    const key = country.trim().toLowerCase();
    // Only 2- and 3-letter tokens are candidates; anything longer is already a
    // name (or something we shouldn't be second-guessing).
    if (key.length !== 2 && key.length !== 3) return null;
    try {
      return (await load()).get(key) ?? null;
    } catch {
      // Reference lookup is an optimisation, never a hard dependency — fall
      // back to the raw token rather than failing the geocode. Reset so a
      // transient DB error doesn't poison the cache for the process lifetime.
      cache = null;
      return null;
    }
  };
}
