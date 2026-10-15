import { describe, expect, it } from 'vitest';
import { decideAddressMatch, type FieldVerdicts } from './address-match-policy.js';

const ALL_MATCH: FieldVerdicts = {
  houseNumber: 'match',
  street: 'match',
  suburb: 'match',
  postalCode: 'match',
  city: 'match',
  name: null,
};

describe('decideAddressMatch', () => {
  it('matches when every field agrees', () => {
    expect(decideAddressMatch(ALL_MATCH)).toEqual({ same: true, rule: 'address_corroborated' });
  });

  it('matches on a postal code alone when the suburb is missing on one side', () => {
    expect(decideAddressMatch({ ...ALL_MATCH, suburb: 'missing' }).same).toBe(true);
  });

  it('matches on a suburb alone when the postal code is missing', () => {
    expect(decideAddressMatch({ ...ALL_MATCH, postalCode: 'missing' }).same).toBe(true);
  });

  it('does not match on the city alone — street names repeat across suburbs', () => {
    expect(decideAddressMatch({ ...ALL_MATCH, suburb: 'missing', postalCode: 'missing' })).toEqual({
      same: false,
      rule: 'not_corroborated',
    });
  });

  it.each(['suburb', 'postalCode', 'city'] as const)(
    'does not match when the %s conflicts, even if the others agree',
    (field) => {
      expect(decideAddressMatch({ ...ALL_MATCH, [field]: 'mismatch' }).same).toBe(false);
    },
  );

  it.each(['houseNumber', 'street'] as const)('does not match without the %s', (field) => {
    expect(decideAddressMatch({ ...ALL_MATCH, [field]: 'mismatch' }).same).toBe(false);
    expect(decideAddressMatch({ ...ALL_MATCH, [field]: 'missing' }).same).toBe(false);
  });

  it('matches on the location name even when the address differs', () => {
    expect(
      decideAddressMatch({ ...ALL_MATCH, street: 'mismatch', suburb: 'mismatch', name: 'match' }),
    ).toEqual({ same: true, rule: 'name_match' });
  });

  it('falls back to the address rule when the names differ', () => {
    expect(decideAddressMatch({ ...ALL_MATCH, name: 'mismatch' }).same).toBe(true);
    expect(decideAddressMatch({ ...ALL_MATCH, street: 'mismatch', name: 'mismatch' }).same).toBe(
      false,
    );
  });
});
