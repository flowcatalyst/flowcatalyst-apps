/**
 * The business rule for "are these two locations the same place?", applied to
 * per-field verdicts. The verdicts come from a decision model (see
 * `clef-verifier.ts`), which does the loose comparison — typos, abbreviations,
 * Straat = Street — so this file holds only the policy:
 *
 *   1. The location names match                                   → same
 *   2. House number AND street match, AND postal code OR suburb
 *      matches, AND no suburb / postal code / city conflicts       → same
 *   3. Anything else                                              → different
 *
 * A city alone never corroborates: big metros repeat street names across
 * suburbs (Johannesburg has 18 separate "1st Avenue"s), so "12 1st Avenue,
 * Johannesburg" is not evidence of a particular house. Such a location is
 * geocoded as new, and an operator fixes it if needed.
 */

export type FieldVerdict = 'match' | 'mismatch' | 'missing';

export interface FieldVerdicts {
  readonly houseNumber: FieldVerdict;
  readonly street: FieldVerdict;
  readonly suburb: FieldVerdict;
  readonly postalCode: FieldVerdict;
  readonly city: FieldVerdict;
  /** Null when either side has no name to compare. */
  readonly name: FieldVerdict | null;
}

export interface AddressMatchDecision {
  readonly same: boolean;
  /** Which rule decided it — recorded on the processing log. */
  readonly rule: 'name_match' | 'address_corroborated' | 'not_corroborated';
}

export function decideAddressMatch(v: FieldVerdicts): AddressMatchDecision {
  if (v.name === 'match') return { same: true, rule: 'name_match' };

  const conflict = v.suburb === 'mismatch' || v.postalCode === 'mismatch' || v.city === 'mismatch';
  const corroborated = v.postalCode === 'match' || v.suburb === 'match';
  if (v.houseNumber === 'match' && v.street === 'match' && corroborated && !conflict) {
    return { same: true, rule: 'address_corroborated' };
  }
  return { same: false, rule: 'not_corroborated' };
}
