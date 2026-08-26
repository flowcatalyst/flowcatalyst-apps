/**
 * Structured address components carried on location events alongside the
 * coordinate. Downstream consumers previously received only lat/lon and had
 * to call back into pinpoint to learn *which* address those coordinates
 * resolved to; embedding the components makes each event self-describing.
 *
 * The field set mirrors `NormalizedAddress` exactly, so a `NormalizedAddress`
 * (from the normalizer or the geocoder) is assignable to `AddressDetails`
 * without a mapping step.
 */
import { Type, type Static } from '@sinclair/typebox';

import type { MasterLocation } from '../master-location.js';

export const AddressDetailsSchema = Type.Object({
  houseNumber: Type.Union([Type.String(), Type.Null()]),
  road: Type.Union([Type.String(), Type.Null()]),
  suburb: Type.Union([Type.String(), Type.Null()]),
  city: Type.String(),
  state: Type.Union([Type.String(), Type.Null()]),
  postalCode: Type.Union([Type.String(), Type.Null()]),
  country: Type.String(),
});

export type AddressDetails = Static<typeof AddressDetailsSchema>;

/**
 * Project a master location's canonical normalized components into the
 * event-payload shape. This is the address pinpoint considers authoritative
 * for the master — not whatever the geocoder echoed back — so every
 * validation event reports the same components the aggregate is stored under.
 */
export function addressDetailsFromMaster(master: MasterLocation): AddressDetails {
  return {
    houseNumber: master.normalizedHouseNumber,
    road: master.normalizedRoad,
    suburb: master.normalizedSuburb,
    city: master.normalizedCity,
    state: master.normalizedState,
    postalCode: master.normalizedPostalCode,
    country: master.normalizedCountry,
  };
}
