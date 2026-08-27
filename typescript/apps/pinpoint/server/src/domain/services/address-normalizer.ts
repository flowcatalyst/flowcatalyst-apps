/**
 * Normalized address — canonical structured representation of an address
 * after libpostal-style normalization. Mirror of Rust
 * `pinpoint-domain/src/services/address_normalizer.rs::NormalizedAddress`.
 *
 * Slice 6 shipped the data type and the trigram-key helper. Slice 8
 * adds the service interface (Rust `AddressNormalizer` trait) and the
 * `addressHash` SHA-256 helper used by the matching pipeline's exact-
 * match dedup. The libpostal HTTP-sidecar impl lives in
 * `infrastructure/services/libpostal-normalizer.ts`.
 *
 * Fields mirror the Rust struct exactly:
 *   - country and city are always present (required by the matching pipeline);
 *   - everything else is nullable because libpostal can't always extract it.
 */
import { createHash } from 'node:crypto';

/**
 * Placeholder stored for `city` / `country` when a best-effort parse could not
 * identify them. Those two columns are NOT NULL (the matching pipeline requires
 * them), so an unresolved value needs a marker rather than null.
 *
 * It is a marker, NOT data: anything consuming a `NormalizedAddress` must treat
 * it as absent. In particular it must never be sent to the geocoder as a search
 * term — `…, randburg, UNKNOWN` asks Photon to find a place called UNKNOWN and
 * costs relevance against a query that is already thin.
 */
export const UNRESOLVED_COMPONENT = 'UNKNOWN';

/** True when a component is the unresolved marker rather than a real value. */
export function isUnresolved(component: string | null): boolean {
  return component === UNRESOLVED_COMPONENT;
}

export interface NormalizedAddress {
  readonly houseNumber: string | null;
  readonly road: string | null;
  readonly suburb: string | null;
  readonly city: string;
  readonly state: string | null;
  readonly postalCode: string | null;
  readonly country: string;
}

/**
 * Address normalization service interface — port of Rust
 * `AddressNormalizer` trait. Plain async, decorator pattern (matches
 * GeocoderService / AddressVerifier). Composed at the AppContext
 * composition root.
 *
 * In strict mode (default) it throws when the city or country can't be
 * identified; the create-location pipeline retries with the country code
 * appended, then falls back to a best-effort (`strict: false`) pass so the
 * address is ingested (as PENDING, for geocoding/review) rather than dropped.
 * Infrastructure failures (HTTP / timeout) always throw regardless of the flag.
 */
export interface NormalizeOptions {
  readonly strict?: boolean;
}

export interface AddressNormalizer {
  normalize(address: string, options?: NormalizeOptions): Promise<NormalizedAddress>;
}

export interface NormalizeWithFallbackResult {
  readonly normalized: NormalizedAddress;
  /**
   * True when both strict attempts failed and the best-effort pass produced
   * this parse. Callers should treat the components as low-confidence.
   */
  readonly bestEffort: boolean;
}

/**
 * The three-step normalization ladder used everywhere a raw address line
 * enters the system:
 *
 *   1. strict parse;
 *   2. strict parse with the country-code hint appended (skipped when there is
 *      no hint);
 *   3. best-effort parse, so a messy-but-real address is still usable rather
 *      than dropped.
 *
 * Throws only when all three fail — which in best-effort mode means libpostal
 * itself is unreachable, not that the address was unparseable. Callers map the
 * throw onto their own error channel (`ADDRESS_NORMALIZATION_FAILED` for use
 * cases, HTTP 502 for routes).
 *
 * Shared so that ingesting an address and geocoding the same line produce
 * identical components; if these ladders ever diverge, `addressHash` stops
 * agreeing with itself.
 */
export async function normalizeWithFallback(
  normalizer: AddressNormalizer,
  address: string,
  countryCode: string | null,
): Promise<NormalizeWithFallbackResult> {
  try {
    try {
      return { normalized: await normalizer.normalize(address), bestEffort: false };
    } catch (firstErr) {
      if (countryCode === null) throw firstErr;
      return {
        normalized: await normalizer.normalize(`${address}, ${countryCode}`),
        bestEffort: false,
      };
    }
  } catch {
    const beInput = countryCode !== null ? `${address}, ${countryCode}` : address;
    return {
      normalized: await normalizer.normalize(beInput, { strict: false }),
      bestEffort: true,
    };
  }
}

/**
 * Build a composite address line used for trigram similarity matching.
 * Mirrors Rust `NormalizedAddress::to_address_line()`. Order matters —
 * the same line is hashed for the pg_trgm index, so any change here
 * invalidates existing indexes.
 */
export function toAddressLine(addr: NormalizedAddress): string {
  const streetParts: string[] = [];
  if (addr.houseNumber) streetParts.push(addr.houseNumber);
  if (addr.road) streetParts.push(addr.road);
  const street = streetParts.join(' ');

  const segments: string[] = [];
  if (street.length > 0) segments.push(street);
  if (addr.suburb) segments.push(addr.suburb);
  segments.push(addr.city);
  segments.push(addr.country);
  return segments.join(', ');
}

/**
 * Deterministic SHA-256 hash over the normalized components, used by
 * the matching pipeline for exact-match dedup on `address_hash`. Mirror
 * of Rust `NormalizedAddress::address_hash()` — same pipe-delimited
 * shape, same lowercase+trim normalization, same field order.
 *
 * Cross-language stability matters: a TS pinpoint write must collide
 * with a Rust pinpoint write of the same address. If you ever need to
 * change this, you also need a backfill migration to rehash every
 * existing `master_locations.address_hash` row.
 */
export function addressHash(addr: NormalizedAddress): string {
  const sep = Buffer.from('|', 'utf8');
  const hasher = createHash('sha256');

  const part = (value: string | null): void => {
    if (value !== null) {
      hasher.update(Buffer.from(value.toLowerCase().trim(), 'utf8'));
    }
  };

  // Order MUST match the Rust impl: houseNumber|road|suburb|city|state|postalCode|country
  part(addr.houseNumber);
  hasher.update(sep);
  part(addr.road);
  hasher.update(sep);
  part(addr.suburb);
  hasher.update(sep);
  part(addr.city);
  hasher.update(sep);
  part(addr.state);
  hasher.update(sep);
  part(addr.postalCode);
  hasher.update(sep);
  part(addr.country);

  return hasher.digest('hex');
}
