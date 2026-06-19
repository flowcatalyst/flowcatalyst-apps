/**
 * Branded IDs for the locations subdomain. Pinpoint TSIDs use a 3-char prefix
 * + underscore + 13-char payload, registered with AggregateRegistry's
 * prefixMap so plain-object aggregates resolve at persist time.
 *
 * `MasterLocationId` is declared here for use by Location's foreign reference,
 * even though the master-locations aggregate itself doesn't land until
 * Slice 8.
 */
export type LocationId = string & { readonly __brand: 'LocationId' };
export type MasterLocationId = string & { readonly __brand: 'MasterLocationId' };
export type LocationAttributeId = string & { readonly __brand: 'LocationAttributeId' };

export const LOCATION_ID_PREFIX = 'loc' as const;
export const MASTER_LOCATION_ID_PREFIX = 'mlo' as const;
export const LOCATION_ATTRIBUTE_ID_PREFIX = 'lat' as const;

export function asLocationId(value: string): LocationId {
  return value as LocationId;
}
export function asMasterLocationId(value: string): MasterLocationId {
  return value as MasterLocationId;
}
export function asLocationAttributeId(value: string): LocationAttributeId {
  return value as LocationAttributeId;
}
