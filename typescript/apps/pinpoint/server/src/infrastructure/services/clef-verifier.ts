/**
 * Clef-backed `AddressVerifier` — asks a decision model one yes/no question
 * ("same physical location?") through the SystemOne API instead of prompting a
 * chat LLM for JSON. The answer is a calibrated probability, so there is no
 * output to parse and no free-text reasoning; `reasoning` reports the
 * probability instead.
 *
 * The matching rules from `VERIFIER_SYSTEM_PROMPT` ride along as the question's
 * instructions so a provider swap keeps the same notion of "same place".
 *
 * Errors are reported via `onError` and swallowed (returns null), like every
 * other verifier: a decision-model outage must not block the matching pipeline.
 */
import {
  VERIFIER_SYSTEM_PROMPT,
  type AddressVerifier,
  type VerificationResult,
} from '../../domain/services/address-verifier.js';
import type { SystemOneClient } from './systemone-client.js';

export interface ClefVerifierConfig {
  readonly client: SystemOneClient;
  /** P(same location) at or above which the match is confirmed. Default 0.5. */
  readonly threshold?: number;
  /** Optional log hook called when verification fails. */
  readonly onError?: (err: unknown) => void;
}

const QUESTION_ID = 'same_location';

/** The prompt's rule list, without the chat-model framing around it. */
const MATCHING_RULES = VERIFIER_SYSTEM_PROMPT.split('\n')
  .filter((line) => line.startsWith('- '))
  .join('\n');

export function createClefVerifier(config: ClefVerifierConfig): AddressVerifier {
  const threshold = config.threshold ?? 0.5;

  return {
    async verify(
      inputAddress: string,
      candidateAddress: string,
    ): Promise<VerificationResult | null> {
      try {
        const response = await config.client.decide({
          state: { input_address: inputAddress, candidate_address: candidateAddress },
          questions: {
            [QUESTION_ID]: {
              type: 'noul',
              instructions:
                'Do the input address and the candidate address refer to the same physical location?\n' +
                MATCHING_RULES,
              criteria: {
                true: 'Same physical location, allowing for spelling, abbreviation and missing components.',
                false: 'Different locations — e.g. a different house number, street or city.',
              },
            },
          },
        });
        const answer = response.answers[QUESTION_ID];
        if (answer?.type !== 'noul') {
          throw new Error(`Expected a noul answer for '${QUESTION_ID}', got ${answer?.type}`);
        }
        const p = answer.noul;
        const confirmed = p >= threshold;
        return {
          match_confirmed: confirmed,
          confidence: confirmed ? p : 1 - p,
          reasoning: `${config.client.model}: P(same location) = ${p.toFixed(3)}`,
        };
      } catch (err) {
        config.onError?.(err);
        return null;
      }
    },
  };
}
