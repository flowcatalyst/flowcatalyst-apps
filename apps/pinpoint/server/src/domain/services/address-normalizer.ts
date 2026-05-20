/**
 * Normalized address — canonical structured representation of an address
 * after libpostal-style normalization. Mirror of Rust
 * `pinpoint-domain/src/services/address_normalizer.rs::NormalizedAddress`.
 *
 * Slice 6 ships the data type only — the `AddressNormalizer` service Tag
 * lands later (libpostal binding decision is part of Slice 7 alongside
 * LLM services). For now the type is used as the input shape for forward
 * geocoding and as the structured output of reverse geocoding.
 *
 * Fields mirror the Rust struct exactly:
 *   - country and city are always present (required by the matching pipeline);
 *   - everything else is nullable because libpostal can't always extract it.
 */
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
