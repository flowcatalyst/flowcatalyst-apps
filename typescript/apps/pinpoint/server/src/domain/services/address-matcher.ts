/**
 * Pure address-matching algorithm. Port of Rust
 * `pinpoint-domain/src/services/address_matcher.rs::AddressMatcher`.
 *
 * Not a service Tag — pure module with one entry point `findMatch`. The
 * `MatchingConfig` thresholds drive accept/reject decisions per-component
 * and overall. Substitutions are applied before scoring so common
 * abbreviations / Afrikaans → English / ZA city aliases don't tank
 * Jaro-Winkler similarity.
 *
 * The Rust pinpoint runs this between the pg_trgm fuzzy candidate fetch
 * (returns up to ~50 candidates) and the optional LLM verifier — same
 * shape here.
 */
import type { MasterLocation } from '../locations/master-location.js';
import type { MatchMethod } from '../locations/location.js';
import type { NormalizedAddress } from './address-normalizer.js';

export type { MatchMethod };

/**
 * Narrow structural subset of `MatchingConfig` — the matcher only reads
 * thresholds, not the row's id/scope/timestamps. Keeping the parameter
 * type structural lets tests pass a bare threshold record without
 * fabricating a full aggregate row.
 */
export interface MatchThresholds {
  readonly streetThreshold: number;
  readonly houseNumberThreshold: number;
  readonly postalCodeThreshold: number;
  readonly stateThreshold: number;
  readonly overallThreshold: number;
}

export interface MatchResult {
  readonly masterLocationId: string;
  readonly confidence: number;
  readonly method: MatchMethod;
}

/**
 * 80-entry substitution table — verbatim port of Rust SUBSTITUTIONS.
 * Order matters: per-word substitutions first (street types), then full-
 * value substitutions (city aliases). Both directions of a swap need to
 * be present for symmetric matching.
 *
 * Pin this list: changes here change matcher behavior + invalidate any
 * tuning done against an existing dataset.
 */
const SUBSTITUTIONS: ReadonlyArray<readonly [string, string]> = [
  // City aliases
  ['joburg', 'johannesburg'],
  ['jhb', 'johannesburg'],
  ['jozi', 'johannesburg'],
  ['pta', 'pretoria'],
  ['cpt', 'cape town'],
  ['dbn', 'durban'],
  ['pe', 'port elizabeth'],
  ['gqeberha', 'port elizabeth'],
  ['bloemies', 'bloemfontein'],
  ['bloem', 'bloemfontein'],
  // Afrikaans → English street types
  ['straat', 'street'],
  ['str.', 'street'],
  ['str', 'street'],
  ['laan', 'lane'],
  ['weg', 'road'],
  ['rylaan', 'drive'],
  ['singel', 'crescent'],
  ['rif', 'drive'],
  // Common abbreviations
  ['st.', 'street'],
  ['rd.', 'road'],
  ['rd', 'road'],
  ['ave.', 'avenue'],
  ['ave', 'avenue'],
  ['dr.', 'drive'],
  ['dr', 'drive'],
  ['ln.', 'lane'],
  ['ln', 'lane'],
  ['blvd.', 'boulevard'],
  ['blvd', 'boulevard'],
  ['ct.', 'court'],
  ['ct', 'court'],
  ['pl.', 'place'],
  ['pl', 'place'],
  ['cres.', 'crescent'],
  ['cres', 'crescent'],
  // Country variants
  ['sa', 'south africa'],
  ['za', 'south africa'],
  ['zaf', 'south africa'],
  ['rsa', 'south africa'],
  ['uk', 'united kingdom'],
  ['gbr', 'united kingdom'],
  ['usa', 'united states'],
  ['us', 'united states'],
];

const SUBSTITUTION_MAP: ReadonlyMap<string, string> = new Map(SUBSTITUTIONS);

/**
 * Per-word substitution — strips non-alphanumerics from each token to
 * normalize trailing punctuation, then looks up in SUBSTITUTION_MAP.
 * Mirror of Rust `apply_substitutions`.
 */
function applySubstitutions(input: string): string {
  const lower = input.toLowerCase();
  return lower
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((word) => {
      const trimmed = word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
      const sub = SUBSTITUTION_MAP.get(trimmed);
      return sub ?? word;
    })
    .join(' ');
}

/**
 * Full-value substitution — looks up the entire trimmed lowercase value.
 * Used for city aliases like "joburg" → "johannesburg" and country codes
 * like "ZA" → "south africa". Mirror of Rust `apply_full_substitution`.
 */
function applyFullSubstitution(input: string): string {
  const lower = input.toLowerCase().trim();
  return SUBSTITUTION_MAP.get(lower) ?? lower;
}

/**
 * Jaro-Winkler similarity in [0, 1]. Port of the standard algorithm —
 * same shape as Rust `strsim::jaro_winkler` for the prefix-boosted
 * variant (prefixLength=4, scalingFactor=0.1). Implementation kept
 * deliberately literal so we can compare against the Rust crate's
 * unit-test outputs.
 */
function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches: boolean[] = Array(a.length).fill(false);
  const bMatches: boolean[] = Array(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;

  let prefixLength = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] !== b[i]) break;
    prefixLength++;
  }

  return jaro + prefixLength * 0.1 * (1 - jaro);
}

/**
 * Compute Jaro-Winkler over two optional values. Both missing or one
 * missing returns 1.0 (Rust convention: missing data is neutral, not
 * penalizing). Lowercase both before scoring.
 */
function compareOptionalScore(a: string | null, b: string | null): number {
  if (a === null && b === null) return 1;
  if (a === null || b === null) return 1;
  return jaroWinkler(a.toLowerCase(), b.toLowerCase());
}

/**
 * Find the best matching master location for a normalized input.
 *
 * Algorithm (mirrors Rust):
 *  1. Exact hash match → return immediately, confidence 1.0, EXACT_HASH.
 *  2. For each candidate:
 *     a. Apply substitutions to city/country/road/state.
 *     b. Jaro-Winkler each component (missing-data-is-neutral).
 *     c. Reject if any of street/houseNumber/postalCode/state below threshold.
 *     d. Overall = mean of 6 component scores.
 *     e. Reject if overall below threshold.
 *  3. Return the best candidate by overall score, FUZZY.
 *
 * Returns null when no candidate clears all thresholds. Callers
 * (create-location pipeline) optionally run an LLM verifier on the
 * winner before accepting it.
 */
export function findMatch(
  input: NormalizedAddress,
  inputHash: string,
  candidates: readonly MasterLocation[],
  config: MatchThresholds,
): MatchResult | null {
  // 1. Exact hash fast path.
  for (const candidate of candidates) {
    if (candidate.addressHash === inputHash) {
      return {
        masterLocationId: candidate.id,
        confidence: 1,
        method: 'EXACT_HASH',
      };
    }
  }

  // 2. Pre-substitute the input fields once.
  const inputCity = applyFullSubstitution(input.city);
  const inputCountry = applyFullSubstitution(input.country);
  const inputRoad = input.road !== null ? applySubstitutions(input.road) : null;
  const inputState = input.state !== null ? applyFullSubstitution(input.state) : null;

  let bestMatch: MatchResult | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const candCity = applyFullSubstitution(candidate.normalizedCity);
    const candCountry = applyFullSubstitution(candidate.normalizedCountry);
    const candRoad =
      candidate.normalizedRoad !== null ? applySubstitutions(candidate.normalizedRoad) : null;
    const candState =
      candidate.normalizedState !== null ? applyFullSubstitution(candidate.normalizedState) : null;

    const streetScore =
      inputRoad !== null && candRoad !== null ? jaroWinkler(inputRoad, candRoad) : 1;
    const houseNumberScore = compareOptionalScore(
      input.houseNumber,
      candidate.normalizedHouseNumber,
    );
    const postalCodeScore = compareOptionalScore(input.postalCode, candidate.normalizedPostalCode);
    const stateScore =
      inputState !== null && candState !== null ? jaroWinkler(inputState, candState) : 1;
    const cityScore = jaroWinkler(inputCity, candCity);
    const countryScore = jaroWinkler(inputCountry, candCountry);

    // Per-component thresholds (city + country deliberately NOT gated;
    // the overall threshold catches city/country mismatches at the mean).
    if (streetScore < config.streetThreshold) continue;
    if (houseNumberScore < config.houseNumberThreshold) continue;
    if (postalCodeScore < config.postalCodeThreshold) continue;
    if (stateScore < config.stateThreshold) continue;

    const overall =
      (streetScore + houseNumberScore + postalCodeScore + stateScore + cityScore + countryScore) /
      6;

    if (overall < config.overallThreshold) continue;

    if (overall > bestScore) {
      bestScore = overall;
      bestMatch = {
        masterLocationId: candidate.id,
        confidence: overall,
        method: 'FUZZY',
      };
    }
  }

  return bestMatch;
}

// Exports for testing.
export const __internal = {
  applySubstitutions,
  applyFullSubstitution,
  jaroWinkler,
} as const;
