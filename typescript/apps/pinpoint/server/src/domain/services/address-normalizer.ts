/**
 * Structured address components — what the geocoder resolves an address to,
 * what an operator edits, and what the location events carry. Matching no
 * longer parses addresses into these (see `address-line.ts`); a freshly
 * ingested master holds only its address line, with `city` (and `country`,
 * absent a hint) set to the UNRESOLVED marker until it is geocoded.
 *
 * `city` and `country` are always present (NOT NULL columns); everything
 * else is nullable.
 */

/**
 * Placeholder stored for `city` / `country` until the geocoder resolves them.
 * Those two columns are NOT NULL, so an unresolved value needs a marker rather
 * than null.
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
 * Join components into an address line — the matching line for a master whose
 * components an operator edited (hashed with `addressLineHash`). Unresolved
 * markers are left out.
 */
export function toAddressLine(addr: NormalizedAddress): string {
  const streetParts: string[] = [];
  if (addr.houseNumber) streetParts.push(addr.houseNumber);
  if (addr.road) streetParts.push(addr.road);
  const street = streetParts.join(' ');

  const segments: string[] = [];
  if (street.length > 0) segments.push(street);
  if (addr.suburb) segments.push(addr.suburb);
  if (!isUnresolved(addr.city)) segments.push(addr.city);
  if (!isUnresolved(addr.country)) segments.push(addr.country);
  return segments.join(', ');
}
