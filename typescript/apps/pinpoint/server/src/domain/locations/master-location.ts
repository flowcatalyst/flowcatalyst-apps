import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { NormalizedAddress } from '../services/address-normalizer.js';
import type { LocationId, MasterLocationId } from './ids.js';
import type { Location } from './location.js';

export const MASTER_LOCATION_TYPE = 'MasterLocation' as const;

/**
 * Master locations are pinpoint's own reference data — addresses whose
 * coordinates we produced ourselves (our OSM index, an operator, or a
 * delivery vehicle on site). Never third-party data: a Google Maps geocode may
 * only be cached, so it can never become a master.
 *
 *   DRAFT     — from a delivery capture: coordinates are good, the address
 *               (reverse-geocoded by Photon) still needs capturing properly
 *   VALIDATED — usable for matching: incoming locations that match copy it
 *   REJECTED  — an operator said it isn't a real place
 *
 * Masters have no child locations. A location that matches copies the
 * master's data and keeps its id as a reference only.
 */
export type MasterLocationStatus = 'DRAFT' | 'VALIDATED' | 'REJECTED';

/** Who produced a master's coordinates. Third-party sources are deliberately absent. */
export const MASTER_GEOCODE_SOURCES = ['PHOTON', 'OPERATOR', 'DELIVERY_CAPTURE'] as const;
export type MasterGeocodeSource = (typeof MASTER_GEOCODE_SOURCES)[number];

/** How a master came to exist. */
export const MASTER_ORIGINS = ['LOCATION_APPROVAL', 'DELIVERY_CAPTURE', 'MIGRATED'] as const;
export type MasterOrigin = (typeof MASTER_ORIGINS)[number];

export interface MasterLocation {
  readonly id: MasterLocationId;
  readonly clientId: ClientId;
  readonly partitionId: PartitionId | null;
  /** The name of the location it came from — the verifier's name rule compares it. */
  readonly name: string | null;

  readonly normalizedHouseNumber: string | null;
  readonly normalizedRoad: string | null;
  readonly normalizedSuburb: string | null;
  readonly normalizedCity: string;
  readonly normalizedState: string | null;
  readonly normalizedPostalCode: string | null;
  readonly normalizedCountry: string;
  readonly addressHash: string;
  /** The tidied address line — trigram search + verifier comparison key. */
  readonly normalizedAddressLine: string | null;

  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly geocodeSource: MasterGeocodeSource | null;

  readonly origin: MasterOrigin;
  /** The approved location it was created from (origin LOCATION_APPROVAL). */
  readonly originLocationId: LocationId | null;
  /** GPS accuracy of a delivery capture, in metres. */
  readonly captureAccuracyM: number | null;
  readonly capturedAt: Date | null;

  readonly status: MasterLocationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly validatedAt: Date | null;
}

export interface MasterAddressInput {
  readonly normalizedHouseNumber: string | null;
  readonly normalizedRoad: string | null;
  readonly normalizedSuburb: string | null;
  readonly normalizedCity: string;
  readonly normalizedState: string | null;
  readonly normalizedPostalCode: string | null;
  readonly normalizedCountry: string;
  readonly addressHash: string;
  readonly normalizedAddressLine: string;
}

/** Thrown when something tries to make our reference data out of third-party coordinates. */
export class ThirdPartyGeocodeError extends Error {
  constructor(source: string | null) {
    super(`A master location can't be created from ${source ?? 'unknown'} coordinates.`);
  }
}

export const MasterLocation = {
  /**
   * From an approved location whose coordinates are our own (Photon or an
   * operator). VALIDATED — it is usable for matching straight away.
   */
  fromApprovedLocation(
    location: Location,
    input: { readonly id: MasterLocationId; readonly address: MasterAddressInput; readonly now: Date },
  ): MasterLocation {
    const source = location.geocodeSource;
    if (source !== 'PHOTON' && source !== 'OPERATOR') throw new ThirdPartyGeocodeError(source);
    if (location.latitude === null || location.longitude === null) {
      throw new Error(`Location '${location.id}' has no coordinates.`);
    }
    return {
      id: input.id,
      clientId: location.clientId,
      partitionId: location.partitionId,
      name: location.name,
      ...input.address,
      latitude: location.latitude,
      longitude: location.longitude,
      geocodeSource: source,
      origin: 'LOCATION_APPROVAL',
      originLocationId: location.id,
      captureAccuracyM: null,
      capturedAt: null,
      status: 'VALIDATED',
      createdAt: input.now,
      updatedAt: input.now,
      validatedAt: input.now,
    };
  },

  /**
   * From a delivery vehicle's GPS capture. DRAFT: the coordinates are ours and
   * good, the address (Photon reverse geocode, or what the driver sent) still
   * has to be captured properly before it is used for matching.
   */
  fromCapture(input: {
    readonly id: MasterLocationId;
    readonly clientId: ClientId;
    readonly partitionId: PartitionId | null;
    readonly latitude: number;
    readonly longitude: number;
    readonly accuracyM: number | null;
    readonly capturedAt: Date;
    readonly address: MasterAddressInput;
    readonly now: Date;
  }): MasterLocation {
    return {
      id: input.id,
      clientId: input.clientId,
      partitionId: input.partitionId,
      name: null,
      ...input.address,
      latitude: input.latitude,
      longitude: input.longitude,
      geocodeSource: 'DELIVERY_CAPTURE',
      origin: 'DELIVERY_CAPTURE',
      originLocationId: null,
      captureAccuracyM: input.accuracyM,
      capturedAt: input.capturedAt,
      status: 'DRAFT',
      createdAt: input.now,
      updatedAt: input.now,
      validatedAt: null,
    };
  },

  /** DRAFT → VALIDATED once someone captured the address properly. */
  completed(
    prior: MasterLocation,
    input: { readonly address: MasterAddressInput; readonly name: string | null; readonly now: Date },
  ): MasterLocation {
    return {
      ...prior,
      ...input.address,
      name: input.name,
      status: 'VALIDATED',
      validatedAt: input.now,
      updatedAt: input.now,
    };
  },

  /** Operator correction of the address (status unchanged). */
  updated(
    prior: MasterLocation,
    input: MasterAddressInput & { readonly now: Date },
  ): MasterLocation {
    const { now, ...address } = input;
    return { ...prior, ...address, updatedAt: now };
  },

  /** * → REJECTED. */
  rejected(prior: MasterLocation, now: Date): MasterLocation {
    return { ...prior, status: 'REJECTED', updatedAt: now };
  },
} as const;

/** A geocoder's / operator's components in the master's field shape. */
export function masterAddressFrom(
  address: NormalizedAddress,
  key: { readonly addressHash: string; readonly normalizedAddressLine: string },
): MasterAddressInput {
  return {
    normalizedHouseNumber: address.houseNumber,
    normalizedRoad: address.road,
    normalizedSuburb: address.suburb,
    normalizedCity: address.city,
    normalizedState: address.state,
    normalizedPostalCode: address.postalCode,
    normalizedCountry: address.country,
    ...key,
  };
}
