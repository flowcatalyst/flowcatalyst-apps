import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { MasterLocationId } from './ids.js';
import { GEOCODE_SOURCES } from '../services/geocoder.js';

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

/** A geocoder (`PHOTON`, `GOOGLE_MAPS`) or an operator-confirmed geocode. */
export const MASTER_GEOCODE_SOURCES = [...GEOCODE_SOURCES, 'OPERATOR'] as const;
export type MasterGeocodeSource = (typeof MASTER_GEOCODE_SOURCES)[number];

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
  /** Who produced the coordinates: a geocoder, or an operator. Null until geocoded. */
  readonly geocodeSource: MasterGeocodeSource | null;
  /**
   * When cached third-party coordinates must be refreshed or dropped (Google
   * Maps' terms allow caching for 30 days). Null for our own sources.
   */
  readonly geocodeExpiresAt: Date | null;

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
      geocodeSource: null,
      geocodeExpiresAt: null,
      status: 'PENDING',
      createdAt: input.now,
      updatedAt: input.now,
      validatedAt: null,
    };
  },

  /** Transition PENDING → GEOCODED with resolved coordinates. */
  geocoded(
    prior: MasterLocation,
    coords: {
      readonly latitude: number;
      readonly longitude: number;
      readonly source?: MasterGeocodeSource;
      /** Required for third-party sources that may only be cached for a while. */
      readonly expiresAt?: Date | null;
    },
    now: Date,
  ): MasterLocation {
    return {
      ...prior,
      latitude: coords.latitude,
      longitude: coords.longitude,
      geocodeSource: coords.source ?? null,
      geocodeExpiresAt: coords.expiresAt ?? null,
      status: 'GEOCODED',
      updatedAt: now,
    };
  },

  /**
   * Refreshed coordinates for an already-geocoded master (e.g. a cached Google
   * geocode renewed before it expires). Status is unchanged.
   */
  regeocoded(
    prior: MasterLocation,
    coords: {
      readonly latitude: number;
      readonly longitude: number;
      readonly source: MasterGeocodeSource;
      readonly expiresAt: Date | null;
    },
    now: Date,
  ): MasterLocation {
    return {
      ...prior,
      latitude: coords.latitude,
      longitude: coords.longitude,
      geocodeSource: coords.source,
      geocodeExpiresAt: coords.expiresAt,
      updatedAt: now,
    };
  },

  /**
   * Cached third-party coordinates expired without a refresh: drop them and
   * send the master back to PENDING, so it is geocoded (and reviewed) again.
   */
  geocodeExpired(prior: MasterLocation, now: Date): MasterLocation {
    return {
      ...prior,
      latitude: null,
      longitude: null,
      geocodeSource: null,
      geocodeExpiresAt: null,
      status: 'PENDING',
      validatedAt: null,
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

  /**
   * Manually edit normalized components. Caller is responsible for the
   * new `addressHash` + `normalizedAddressLine` derivation; we don't
   * recompute here to keep this pure.
   */
  updated(
    prior: MasterLocation,
    input: {
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
    },
  ): MasterLocation {
    return {
      ...prior,
      normalizedHouseNumber: input.normalizedHouseNumber,
      normalizedRoad: input.normalizedRoad,
      normalizedSuburb: input.normalizedSuburb,
      normalizedCity: input.normalizedCity,
      normalizedState: input.normalizedState,
      normalizedPostalCode: input.normalizedPostalCode,
      normalizedCountry: input.normalizedCountry,
      addressHash: input.addressHash,
      normalizedAddressLine: input.normalizedAddressLine,
      updatedAt: input.now,
    };
  },

  /** Transition * → REJECTED. */
  rejected(prior: MasterLocation, now: Date): MasterLocation {
    return { ...prior, status: 'REJECTED', updatedAt: now };
  },
} as const;
