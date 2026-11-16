/**
 * Match an incoming address line to an existing VALIDATED master location.
 * Shared by `create-location` and `rematch-location`.
 *
 *   1. Exact duplicate: the tidied line's hash equals a VALIDATED master's →
 *      match, no model call.
 *   2. Otherwise take the closest few VALIDATED masters by trigram similarity
 *      and ask the address verifier about each, in parallel.
 *   3. The best match is the confirmed candidate with the highest confidence,
 *      provided it reaches the configured threshold. No winner → null, and the
 *      caller creates a new PENDING master (geocoded, then fixed by an operator
 *      if needed).
 *
 * With no verifier configured (Noop returns null) only exact duplicates match.
 * Every verdict is returned (`verdicts`) for the caller to record on the
 * location's processing trail once the location row exists.
 */
import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { LocationId } from '../locations/ids.js';
import type { MatchMethod } from '../locations/location.js';
import type { MasterLocation } from '../locations/master-location.js';
import type { MasterLocationRepository } from '../locations/master-location.repository.js';
import type { AddressVerifier, VerificationResult } from './address-verifier.js';
import { toAddressLine } from './address-normalizer.js';

/** Minimum trigram similarity for a master to be considered at all. */
const CANDIDATE_SIMILARITY = 0.3;
/** How many of the closest candidates the verifier checks. */
const CANDIDATES_VERIFIED = 5;

export interface LocationMatchDeps {
  readonly masters: MasterLocationRepository;
  readonly verifier: AddressVerifier;
}

export interface LocationMatchInput {
  readonly clientId: ClientId;
  readonly partitionId: PartitionId | null;
  /** Tidied address line (see `address-line.ts`). */
  readonly addressLine: string;
  readonly addressHash: string;
  /** The location's name, compared against the candidates' location names. */
  readonly name: string | null;
  /** The location being matched. */
  readonly locationId: LocationId;
  /** Minimum verifier confidence for a confirmed match to win. */
  readonly threshold: number;
}

/** One candidate the verifier was asked about — for the location's trail. */
export interface CandidateVerdict {
  readonly masterLocationId: string;
  readonly candidateAddress: string;
  readonly outcome: 'confirmed' | 'rejected' | 'no_opinion';
  readonly matchConfirmed: boolean | null;
  readonly confidence: number | null;
  readonly reasoning: string | null;
}

export interface LocationMatch {
  readonly master: MasterLocation;
  readonly method: MatchMethod;
  readonly confidence: number;
}

export interface LocationMatchOutcome {
  readonly match: LocationMatch | null;
  /** Candidates the verifier was asked about. */
  readonly candidatesChecked: number;
  /** Candidates the verifier explicitly rejected. */
  readonly rejectedMasterIds: readonly string[];
  readonly verdicts: readonly CandidateVerdict[];
}

export async function matchLocation(
  deps: LocationMatchDeps,
  input: LocationMatchInput,
): Promise<LocationMatchOutcome> {
  const hashHit = await deps.masters.findByHash(
    input.clientId,
    input.partitionId,
    input.addressHash,
  );
  if (hashHit && hashHit.status === 'VALIDATED') {
    return {
      match: { master: hashHit, method: 'EXACT_HASH', confidence: 1 },
      candidatesChecked: 0,
      rejectedMasterIds: [],
      verdicts: [],
    };
  }

  const candidates = (
    await deps.masters.findFuzzyCandidates(
      input.clientId,
      input.partitionId,
      input.addressLine,
      CANDIDATE_SIMILARITY,
      CANDIDATES_VERIFIED * 4,
    )
  )
    .filter((c) => c.status === 'VALIDATED')
    .slice(0, CANDIDATES_VERIFIED);

  const checked = await Promise.all(
    candidates.map(async (candidate) => {
      const candidateLine = candidateAddressLine(candidate);
      const candidateNames = candidate.name ? [candidate.name] : [];
      const verdict = await deps.verifier.verify(input.addressLine, candidateLine, {
        inputName: input.name,
        candidateNames,
      });
      return { candidate, candidateLine, verdict };
    }),
  );

  const best = checked
    .filter(
      (c): c is typeof c & { verdict: VerificationResult } =>
        c.verdict !== null && c.verdict.match_confirmed && c.verdict.confidence >= input.threshold,
    )
    .toSorted((a, b) => b.verdict.confidence - a.verdict.confidence)[0];

  return {
    match: best
      ? { master: best.candidate, method: 'FUZZY', confidence: best.verdict.confidence }
      : null,
    candidatesChecked: checked.length,
    rejectedMasterIds: checked
      .filter((c) => c.verdict !== null && !c.verdict.match_confirmed)
      .map((c) => c.candidate.id),
    verdicts: checked.map(({ candidate, candidateLine, verdict }) => ({
      masterLocationId: candidate.id,
      candidateAddress: candidateLine,
      outcome: outcomeOf(verdict),
      matchConfirmed: verdict?.match_confirmed ?? null,
      confidence: verdict?.confidence ?? null,
      reasoning: verdict?.reasoning ?? null,
    })),
  };
}

function outcomeOf(verdict: VerificationResult | null): CandidateVerdict['outcome'] {
  if (verdict === null) return 'no_opinion';
  return verdict.match_confirmed ? 'confirmed' : 'rejected';
}

/** The line a master is compared on: its stored line, else its components. */
export function candidateAddressLine(master: MasterLocation): string {
  return (
    master.normalizedAddressLine ??
    toAddressLine({
      houseNumber: master.normalizedHouseNumber,
      road: master.normalizedRoad,
      suburb: master.normalizedSuburb,
      city: master.normalizedCity,
      state: master.normalizedState,
      postalCode: master.normalizedPostalCode,
      country: master.normalizedCountry,
    })
  );
}
