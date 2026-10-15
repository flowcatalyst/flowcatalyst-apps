/**
 * Clef-backed `AddressVerifier`. Instead of asking a model one overall "same
 * place?" question, it asks a decision model to compare each field — house
 * number, street, suburb, postal code, city and (when both sides have one) the
 * location name — as match / mismatch / missing, all in one SystemOne request.
 * The model does the loose comparison it is good at (typos, abbreviations,
 * Straat = Street); `decideAddressMatch` applies the business rule in code, so
 * the policy is readable, testable and independent of the model's geography.
 *
 * Errors are reported via `onError` and swallowed (returns null), like every
 * other verifier: a decision-model outage must not block the matching pipeline.
 */
import {
  decideAddressMatch,
  type FieldVerdict,
  type FieldVerdicts,
} from '../../domain/services/address-match-policy.js';
import type {
  AddressVerifier,
  VerificationContext,
  VerificationResult,
} from '../../domain/services/address-verifier.js';
import type { DecisionAnswer, DecisionQuestion, SystemOneClient } from './systemone-client.js';

export interface ClefVerifierConfig {
  readonly client: SystemOneClient;
  /** Optional log hook called when verification fails. */
  readonly onError?: (err: unknown) => void;
}

const LOOSE =
  'Treat spelling mistakes, abbreviations and letter case as a match. ' +
  'Answer "missing" if either side does not give one.';

function fieldQuestion(
  instructions: string,
  match: string,
  mismatch: string,
  missing = 'At least one side does not give this.',
): DecisionQuestion {
  return {
    type: 'choice',
    instructions: `${instructions} ${LOOSE}`,
    criteria: { match, mismatch, missing },
  };
}

/**
 * Below this, a field verdict counts as `missing`: the model could not tell,
 * which in practice means it could not separate the field out of a raw line
 * (is "Randburg" the suburb or the city?). Unsure must not be read as evidence
 * either way.
 */
const MIN_FIELD_CONFIDENCE = 0.6;

const ADDRESS_QUESTIONS = {
  house_number: fieldQuestion(
    'Compare the house or street numbers of the input and candidate addresses.',
    'Both give the same number.',
    'They give different numbers.',
  ),
  street: fieldQuestion(
    'Compare the street names, including the road type. Street, St, Str and Straat are the ' +
      'same; Road, Rd and Weg are the same; Avenue, Ave, Laan and Rylaan are the same. A ' +
      'different road type (Road vs Crescent) is a different street.',
    'Same street.',
    'Different streets.',
  ),
  suburb: fieldQuestion(
    'Compare the suburbs — the neighbourhood named in addition to the city or town. ' +
      'First decide, for each address separately, whether it names a suburb at all; the ' +
      'city or town itself is not a suburb.',
    'Both addresses name a suburb, and it is the same suburb.',
    'Both addresses name a suburb, and they are different suburbs.',
    'Only one address names a suburb, or neither does.',
  ),
  postal_code: fieldQuestion(
    'Compare the postal codes.',
    'Same postal code.',
    'Different postal codes.',
  ),
  city: fieldQuestion('Compare the cities or towns.', 'Same city.', 'Different cities.'),
} as const;

const NAME_QUESTION = fieldQuestion(
  "Does the input location's name refer to the same place as any of the candidate's names?",
  'The input name matches one of the candidate names.',
  'The input name matches none of the candidate names.',
);

export function createClefVerifier(config: ClefVerifierConfig): AddressVerifier {
  return {
    async verify(
      inputAddress: string,
      candidateAddress: string,
      context?: VerificationContext,
    ): Promise<VerificationResult | null> {
      try {
        const inputName = context?.inputName?.trim() || null;
        const candidateNames = (context?.candidateNames ?? []).map((n) => n.trim()).filter(Boolean);
        const withName = inputName !== null && candidateNames.length > 0;

        const response = await config.client.decide({
          state: {
            input: { address: inputAddress, ...(inputName ? { name: inputName } : {}) },
            candidate: {
              address: candidateAddress,
              ...(candidateNames.length > 0 ? { names: candidateNames } : {}),
            },
          },
          questions: withName ? { ...ADDRESS_QUESTIONS, name: NAME_QUESTION } : ADDRESS_QUESTIONS,
        });

        const read = (id: string) => readChoice(id, response.answers[id]);
        const fields = {
          house_number: read('house_number'),
          street: read('street'),
          suburb: read('suburb'),
          postal_code: read('postal_code'),
          city: read('city'),
          ...(withName ? { name: read('name') } : {}),
        };
        const verdicts: FieldVerdicts = {
          houseNumber: fields.house_number.verdict,
          street: fields.street.verdict,
          suburb: fields.suburb.verdict,
          postalCode: fields.postal_code.verdict,
          city: fields.city.verdict,
          name: fields.name?.verdict ?? null,
        };
        const decision = decideAddressMatch(verdicts);

        const summary = Object.entries(fields)
          .map(([id, f]) => `${id}=${f.verdict}(${f.p.toFixed(2)})`)
          .join(' ');
        return {
          match_confirmed: decision.same,
          // The least certain field verdict bounds how sure the decision can be.
          confidence: Math.min(...Object.values(fields).map((f) => f.p)),
          reasoning: `${config.client.model}: ${summary} → ${decision.rule}`,
        };
      } catch (err) {
        config.onError?.(err);
        return null;
      }
    },
  };
}

function readChoice(
  id: string,
  answer: DecisionAnswer | undefined,
): { verdict: FieldVerdict; p: number } {
  if (answer?.type !== 'choice') {
    throw new Error(`Expected a choice answer for '${id}', got ${answer?.type}`);
  }
  const verdict = answer.choice;
  if (verdict !== 'match' && verdict !== 'mismatch' && verdict !== 'missing') {
    throw new Error(`Unexpected choice '${verdict}' for '${id}'`);
  }
  const p = answer.probabilities[verdict] ?? answer.confidence;
  return { verdict: p < MIN_FIELD_CONFIDENCE ? 'missing' : verdict, p };
}
