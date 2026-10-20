/**
 * Find an existing VALIDATED master location for an address, across every
 * master the caller may see — the geocode routes' "check our own data first"
 * step. Same rule as location matching (`location-matching.ts`): an exact
 * address-line duplicate matches outright; otherwise the closest masters by
 * trigram similarity are checked by the address verifier, and the best
 * confirmed one at or above the threshold wins.
 *
 * Read-only: nothing is written, not even the processing trail.
 */
import type { MasterLocation } from '../locations/master-location.js';
import type { LocationRepository } from '../locations/location.repository.js';
import type {
  MasterLocationRepository,
  MasterLookupScope,
} from '../locations/master-location.repository.js';
import type { AddressVerifier, VerificationResult } from './address-verifier.js';
import { addressLineHash, tidyAddressLine } from './address-line.js';
import { candidateAddressLine } from './location-matching.js';

/** Minimum trigram similarity for a master to be considered. */
const CANDIDATE_SIMILARITY = 0.3;
/** How many of the closest masters the verifier checks. */
const CANDIDATES_VERIFIED = 5;

export interface MasterLookupDeps {
  readonly masters: MasterLocationRepository;
  readonly locations: LocationRepository;
  readonly verifier: AddressVerifier;
}

export interface MasterLookupMatch {
  readonly master: MasterLocation;
  readonly method: 'EXACT_HASH' | 'FUZZY';
  readonly confidence: number;
}

export async function lookupMasterLocation(
  deps: MasterLookupDeps,
  input: {
    readonly addressLine: string;
    readonly scope: MasterLookupScope;
    /** Minimum verifier confidence for a confirmed match to win. */
    readonly threshold: number;
  },
): Promise<MasterLookupMatch | null> {
  const line = tidyAddressLine(input.addressLine);
  if (line.length === 0) return null;

  const exact = await deps.masters.findValidatedByHashIn(input.scope, addressLineHash(line));
  if (exact) return { master: exact, method: 'EXACT_HASH', confidence: 1 };

  const candidates = await deps.masters.findValidatedCandidatesIn(
    input.scope,
    line,
    CANDIDATE_SIMILARITY,
    CANDIDATES_VERIFIED,
  );
  const checked = await Promise.all(
    candidates.map(async (master) => {
      const candidateNames = (await deps.locations.listByMaster(master.id))
        .map((l) => l.name)
        .filter((n): n is string => n !== null);
      const verdict = await deps.verifier.verify(line, candidateAddressLine(master), {
        inputName: null,
        candidateNames,
      });
      return { master, verdict };
    }),
  );
  const best = checked
    .filter(
      (c): c is { master: MasterLocation; verdict: VerificationResult } =>
        c.verdict !== null && c.verdict.match_confirmed && c.verdict.confidence >= input.threshold,
    )
    .toSorted((a, b) => b.verdict.confidence - a.verdict.confidence)[0];
  return best ? { master: best.master, method: 'FUZZY', confidence: best.verdict.confidence } : null;
}
