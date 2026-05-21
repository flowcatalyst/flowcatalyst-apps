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
 * Throws on failure. The caller (create-location pipeline) catches +
 * retries with the country code appended; if that retry also fails the
 * caller surfaces an InfrastructureError.
 */
export interface AddressNormalizer {
  normalize(address: string): Promise<NormalizedAddress>;
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
  part(addr.houseNumber); hasher.update(sep);
  part(addr.road); hasher.update(sep);
  part(addr.suburb); hasher.update(sep);
  part(addr.city); hasher.update(sep);
  part(addr.state); hasher.update(sep);
  part(addr.postalCode); hasher.update(sep);
  part(addr.country);

  return hasher.digest('hex');
}
