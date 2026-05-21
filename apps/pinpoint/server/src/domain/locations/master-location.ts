import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { MasterLocationId } from './ids.js';

export const MASTER_LOCATION_TYPE = 'MasterLocation' as const;

/**
 * Master location lifecycle:
 *   PENDING   — just created from normalized address components
 *   GEOCODED  — `validate-master-location` resolved lat/lon via the geocoder
 *   VALIDATED — `confirm-master-location` marked canonical + cascaded
 *               LocationValidated to all child locations
 *   REJECTED  — manually marked as not-a-real-place
 *
 * Note: the Rust use-case names are misleading. `validate-master-location`
 * actually does geocoding (PENDING → GEOCODED); `confirm-master-location`
 * does the canonicalization (GEOCODED → VALIDATED). Names preserved for
 * parity with the Rust pinpoint.
 */
export type MasterLocationStatus = 'PENDING' | 'GEOCODED' | 'VALIDATED' | 'REJECTED';

export interface MasterLocation {
  readonly id: MasterLocationId;
  readonly clientId: ClientId;
  readonly partitionId: PartitionId | null;

  readonly normalizedHouseNumber: string | null;
  readonly normalizedRoad: string | null;
  readonly normalizedSuburb: string | null;
  readonly normalizedCity: string;
  readonly normalizedState: string | null;
  readonly normalizedPostalCode: string | null;
  readonly normalizedCountry: string;
  readonly addressHash: string;
  /**
   * Composite line `<house_number> <road>, <suburb>, <city>, <country>`
   * used as the pg_trgm fuzzy index key. Order matters; see
   * `toAddressLine` in `address-normalizer.ts`.
   */
  readonly normalizedAddressLine: string | null;

  readonly latitude: number | null;
  readonly longitude: number | null;

  readonly status: MasterLocationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly validatedAt: Date | null;
}

export interface CreateMasterLocationInput {
  readonly id: MasterLocationId;
  readonly clientId: ClientId;
  readonly partitionId: PartitionId | null;
  readonly normalizedHouseNumber: string | null;
  readonly normalizedRoad: string | null;
  readonly normalizedSuburb: string | null;
  readonly normalizedCity: string;
  readonly normalizedState: string | null;
  readonly normalizedPostalCode: string | null;
  readonly normalizedCountry: string;
  readonly addressHash: string;
  readonly normalizedAddressLine: string;
  readonly now: Date;
}

export const MasterLocation = {
  create(input: CreateMasterLocationInput): MasterLocation {
    return {
      id: input.id,
      clientId: input.clientId,
      partitionId: input.partitionId,
      normalizedHouseNumber: input.normalizedHouseNumber,
      normalizedRoad: input.normalizedRoad,
      normalizedSuburb: input.normalizedSuburb,
      normalizedCity: input.normalizedCity,
      normalizedState: input.normalizedState,
      normalizedPostalCode: input.normalizedPostalCode,
      normalizedCountry: input.normalizedCountry,
      addressHash: input.addressHash,
      normalizedAddressLine: input.normalizedAddressLine,
      latitude: null,
      longitude: null,
      status: 'PENDING',
      createdAt: input.now,
      updatedAt: input.now,
      validatedAt: null,
    };
  },

  /** Transition PENDING → GEOCODED with resolved coordinates. */
  geocoded(
    prior: MasterLocation,
    coords: { readonly latitude: number; readonly longitude: number },
    now: Date,
  ): MasterLocation {
    return {
      ...prior,
      latitude: coords.latitude,
      longitude: coords.longitude,
      status: 'GEOCODED',
      updatedAt: now,
    };
  },

  /** Transition * → VALIDATED. Sets `validatedAt`. */
  confirmed(prior: MasterLocation, now: Date): MasterLocation {
    return {
      ...prior,
      status: 'VALIDATED',
      validatedAt: now,
      updatedAt: now,
    };
  },
} as const;
