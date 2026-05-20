/**
 * AddressVerifier service interface — port of Rust
 * `pinpoint-domain/src/services/address_verifier.rs::AddressVerifier`.
 *
 * Called by the matching pipeline (Slice 8) after the algorithmic
 * `AddressMatcher` finds a candidate: the LLM receives the normalized
 * input address line and the candidate master location address line,
 * and returns a structured verdict on whether they refer to the same
 * physical location.
 *
 * Plain async interface (not an Effect Tag) — matches the
 * `GeocoderService` pattern from Slice 6. Composition root picks an
 * impl based on `PINPOINT_LLM_PROVIDER` (none / bedrock / ollama).
 *
 * The "verification disabled" path returns `null` rather than throwing
 * — matches Rust's `Ok(None)` semantics. Routes and callers must
 * treat null as "no verification opinion", not "verification failed".
 */
import { z } from 'zod';

/**
 * Structured verifier verdict. Schema is what the LLM emits; the
 * runtime parser validates it. Mirror of Rust `VerificationResult`.
 */
export const VerificationResultSchema = z.object({
  match_confirmed: z
    .boolean()
    .describe('Whether the two addresses refer to the same physical location.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence in the assessment from 0.0 to 1.0.'),
  reasoning: z.string().describe('Brief explanation of why the addresses do or do not match.'),
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export interface AddressVerifier {
  /**
   * Verify whether two normalized address lines refer to the same
   * physical location. Returns null when verification is disabled
   * (Noop impl) or when the underlying provider failed (the Rust
   * pattern: log + return None, never throw, so the matching pipeline
   * stays available even when the LLM is down).
   */
  verify(inputAddress: string, candidateAddress: string): Promise<VerificationResult | null>;
}

/**
 * System prompt — verbatim port of Rust
 * `llm_address_verifier.rs::SYSTEM_PROMPT`. The trigram + algorithmic
 * matcher already filters obvious mismatches; this prompt's job is the
 * borderline cases.
 *
 * Kept here in the domain layer (not in the Bedrock/Ollama impls) so
 * a provider swap can't quietly change the prompt and invalidate any
 * prior verification quality work.
 */
export const VERIFIER_SYSTEM_PROMPT = `You are an address matching expert. You will be given two normalized addresses and must determine if they refer to the same physical location.

Consider:
- Minor spelling variations (e.g. "St" vs "Street", "Rd" vs "Road") are acceptable
- Abbreviations and expansions of the same word are the same
- Missing components (e.g. no postal code) should not disqualify a match if other components align
- Different house numbers almost always mean different locations
- Different streets in the same city are different locations
- Same street different city are different locations

Respond with structured JSON only.`;

export function buildVerifierPrompt(inputAddress: string, candidateAddress: string): string {
  // Same shape as Rust `build_prompt` — prompts ride into the LLM in the
  // same format across both backends so prompt-quality comparisons stay
  // apples-to-apples.
  return `Input address: "${inputAddress}"\nCandidate address: "${candidateAddress}"\n\nAre these the same physical location?`;
}
