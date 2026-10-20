/**
 * AddressVerifier — judges whether a candidate master location is the same
 * physical place as an incoming address. Port of Rust
 * `pinpoint-domain/src/services/address_verifier.rs::AddressVerifier`.
 *
 * Matching (`location-matching.ts`) selects the closest VALIDATED masters by
 * trigram similarity and asks the verifier about each; the Clef decision
 * model is the only real impl (`infrastructure/services/clef-verifier.ts`),
 * Noop turns fuzzy matching off.
 *
 * Returns `null` rather than throwing when verification is disabled or the
 * provider failed — callers treat null as "no opinion", never as a match.
 */

/** A verifier verdict. */
export interface VerificationResult {
  /** Whether the two addresses refer to the same physical location. */
  readonly match_confirmed: boolean;
  /** Confidence in the assessment, 0.0–1.0. */
  readonly confidence: number;
  /** Short explanation (Clef: the per-field verdicts and the rule applied). */
  readonly reasoning: string;
}

/**
 * Optional extra evidence. A location is created with a name ("Clicks
 * Rosebank"); a candidate master's names are those of its linked locations.
 * Verifiers that can't use names ignore this.
 */
export interface VerificationContext {
  readonly inputName?: string | null;
  readonly candidateNames?: readonly string[];
}

export interface AddressVerifier {
  /**
   * Verify whether two normalized address lines refer to the same
   * physical location. Returns null when verification is disabled
   * (Noop impl) or when the underlying provider failed (the Rust
   * pattern: log + return None, never throw, so the matching pipeline
   * stays available even when the LLM is down).
   */
  verify(
    inputAddress: string,
    candidateAddress: string,
    context?: VerificationContext,
  ): Promise<VerificationResult | null>;
}
