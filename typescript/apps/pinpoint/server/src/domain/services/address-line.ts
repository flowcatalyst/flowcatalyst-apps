/**
 * The address line is pinpoint's matching key. There is no parse: a location's
 * raw address is tidied into a canonical line, which feeds
 *
 *   - `addressLineHash` — exact-duplicate lookup on `address_hash`, the free
 *     shortcut that skips the decision model;
 *   - the pg_trgm candidate search on `normalized_address_line`;
 *   - the decision model, which compares lines field by field
 *     (`clef-verifier.ts`).
 *
 * The tidy rules are deliberately few, so the data migration that rehashed the
 * existing rows can reproduce them in SQL (drizzle/…_address_line_hash). Change
 * them and every stored `address_hash` must be recomputed.
 */
import { createHash } from 'node:crypto';

/**
 * Lowercase; collapse whitespace; one comma + one space between segments; no
 * empty, leading or trailing segments.
 */
export function tidyAddressLine(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join(', ');
}

/** SHA-256 (hex) of the tidied line. */
export function addressLineHash(line: string): string {
  return createHash('sha256').update(tidyAddressLine(line), 'utf8').digest('hex');
}
