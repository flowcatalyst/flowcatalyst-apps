import type { ClientId, PartitionId } from '../tenancy/ids.js';
import type { NormalizedAddress } from '../services/address-normalizer.js';
import type { LocationId, MasterLocationId } from './ids.js';
import type { MasterLocation } from './master-location.js';

export const LOCATION_TYPE = 'Location' as const;

/**
 * PENDING (received, no coordinates) → GEOCODED (coordinates, awaiting
 * approval) → VALIDATED (approved; features associated). A location that
 * matched one of our master locations is VALIDATED straight away. REJECTED
 * by an operator.
 */
export type LocationStatus = 'PENDING' | 'GEOCODED' | 'VALIDATED' | 'REJECTED';

export type MatchMethod = 'EXACT_HASH' | 'FUZZY' | 'MANUAL';

/**
 * Where a location's coordinates came from: copied from one of our master
 * locations, a geocoder (Photon = our OSM index; Google Maps = third party,
 * cached 30 days at most), or an operator.
 */
export const LOCATION_GEOCODE_SOURCES = [
  'MASTER_LOCATIONS',
  'PHOTON',
  'GOOGLE_MAPS',
  'OPERATOR',
] as const;
export type LocationGeocodeSource = (typeof LOCATION_GEOCODE_SOURCES)[number];

/** A delivery capture disagrees with the location's coordinates. */
export type CaptureReview = 'DISAGREES';

/**
 * A client's location. It holds its own coordinates, address components,
 * geocode source and approval — master locations are our reference data, not
 * parents: a location that matches one copies its data, keeping only a plain
 * reference (`sourceMasterLocationId`, no FK).
 */
export interface Location {
  readonly id: LocationId;
  readonly clientId: ClientId;
  readonly partitionId: PartitionId | null;
  /** The master location this location's data was copied from, if any. Reference only. */
  readonly sourceMasterLocationId: MasterLocationId | null;
  readonly externalId: string | null;
  readonly name: string | null;

  readonly rawAddressLine1: string;
  /** Editable address that drives normalization + matching. Starts = rawAddressLine1. */
  readonly matchAddress: string;
  readonly rawAddressLine2: string | null;
  readonly rawSuburb: string | null;
  readonly rawCity: string;
  readonly rawState: string | null;
  readonly rawPostalCode: string | null;
  readonly rawCountry: string;

  /** Resolved components (from the master it matched, the geocoder, or an operator). */
  readonly normalizedHouseNumber: string | null;
  readonly normalizedRoad: string | null;
  readonly normalizedSuburb: string | null;
  readonly normalizedCity: string | null;
  readonly normalizedState: string | null;
  readonly normalizedPostalCode: string | null;
  readonly normalizedCountry: string | null;
  /** SHA-256 of the tidied match address — the exact-duplicate key. */
  readonly addressHash: string | null;

  readonly matchConfidence: number | null;
  readonly matchMethod: MatchMethod | null;

  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly geocodeSource: LocationGeocodeSource | null;
  readonly geocodeConfidence: number | null;
  /** Whether the geocode sits on the requested road (null = no road asked for). */
  readonly geocodeRoadMatched: boolean | null;
  /** Cached third-party coordinates must be refreshed or dropped by then (Google: 30 days). */
  readonly geocodeExpiresAt: Date | null;
  readonly geocodedAt: Date | null;
  readonly validatedAt: Date | null;

  /** The DRAFT master a delivery capture created for this address, when it disagreed. */
  readonly captureMasterLocationId: MasterLocationId | null;
  readonly captureDistanceM: number | null;
  readonly captureReview: CaptureReview | null;

  readonly status: LocationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateLocationInput {
  readonly id: LocationId;
  readonly clientId: ClientId;
  readonly partitionId: PartitionId | null;
  readonly externalId: string | null;
  readonly name: string | null;
  readonly rawAddressLine1: string;
  /** Defaults to rawAddressLine1 (the received address) when omitted. */
  readonly matchAddress?: string;
  readonly rawAddressLine2: string | null;
  readonly rawSuburb: string | null;
  readonly rawCity: string;
  readonly rawState: string | null;
  readonly rawPostalCode: string | null;
  readonly rawCountry: string;
  readonly now: Date;
}

export interface LocationGeocode {
  readonly latitude: number;
  readonly longitude: number;
  readonly source: Exclude<LocationGeocodeSource, 'MASTER_LOCATIONS'>;
  readonly confidence: number;
  readonly roadMatched: boolean | null;
  readonly expiresAt: Date | null;
  /** Components to store, or null to keep the current ones. */
  readonly address: NormalizedAddress | null;
}

const NO_GEOCODE = {
  latitude: null,
  longitude: null,
  geocodeSource: null,
  geocodeConfidence: null,
  geocodeRoadMatched: null,
  geocodeExpiresAt: null,
  geocodedAt: null,
  validatedAt: null,
} as const;

function withComponents(prior: Location, address: NormalizedAddress | null): Location {
  if (!address) return prior;
  return {
    ...prior,
    normalizedHouseNumber: address.houseNumber,
    normalizedRoad: address.road,
    normalizedSuburb: address.suburb,
    normalizedCity: address.city || prior.normalizedCity,
    normalizedState: address.state,
    normalizedPostalCode: address.postalCode,
    normalizedCountry: address.country || prior.normalizedCountry,
  };
}

export const Location = {
  /** A received location: PENDING, nothing resolved yet. */
  create(input: CreateLocationInput): Location {
    return {
      id: input.id,
      clientId: input.clientId,
      partitionId: input.partitionId,
      sourceMasterLocationId: null,
      externalId: input.externalId,
      name: input.name,
      rawAddressLine1: input.rawAddressLine1,
      matchAddress: input.matchAddress ?? input.rawAddressLine1,
      rawAddressLine2: input.rawAddressLine2,
      rawSuburb: input.rawSuburb,
      rawCity: input.rawCity,
      rawState: input.rawState,
      rawPostalCode: input.rawPostalCode,
      rawCountry: input.rawCountry,
      normalizedHouseNumber: null,
      normalizedRoad: null,
      normalizedSuburb: null,
      normalizedCity: null,
      normalizedState: null,
      normalizedPostalCode: null,
      normalizedCountry: null,
      addressHash: null,
      matchConfidence: null,
      matchMethod: null,
      ...NO_GEOCODE,
      captureMasterLocationId: null,
      captureDistanceM: null,
      captureReview: null,
      status: 'PENDING',
      createdAt: input.now,
      updatedAt: input.now,
    };
  },

  /**
   * Matched one of our VALIDATED master locations: copy its coordinates and
   * components and keep a reference to it. Approved straight away.
   */
  matchedFrom(
    prior: Location,
    master: MasterLocation,
    match: { readonly method: MatchMethod; readonly confidence: number },
    now: Date,
  ): Location {
    return {
      ...prior,
      sourceMasterLocationId: master.id,
      normalizedHouseNumber: master.normalizedHouseNumber,
      normalizedRoad: master.normalizedRoad,
      normalizedSuburb: master.normalizedSuburb,
      normalizedCity: master.normalizedCity,
      normalizedState: master.normalizedState,
      normalizedPostalCode: master.normalizedPostalCode,
      normalizedCountry: master.normalizedCountry,
      matchMethod: match.method,
      matchConfidence: match.confidence,
      latitude: master.latitude,
      longitude: master.longitude,
      geocodeSource: 'MASTER_LOCATIONS',
      geocodeConfidence: match.confidence,
      geocodeRoadMatched: null,
      geocodeExpiresAt: null,
      geocodedAt: now,
      validatedAt: now,
      status: 'VALIDATED',
      updatedAt: now,
    };
  },

  /** No master matched: back to PENDING with nothing resolved (rematch). */
  unmatched(prior: Location, now: Date): Location {
    return {
      ...prior,
      sourceMasterLocationId: null,
      matchMethod: null,
      matchConfidence: null,
      normalizedHouseNumber: null,
      normalizedRoad: null,
      normalizedSuburb: null,
      normalizedCity: null,
      normalizedState: null,
      normalizedPostalCode: null,
      normalizedCountry: null,
      ...NO_GEOCODE,
      status: 'PENDING',
      updatedAt: now,
    };
  },

  /** PENDING → GEOCODED with a geocoder's (or an operator's) coordinates. */
  geocoded(prior: Location, geocode: LocationGeocode, now: Date): Location {
    return {
      ...withComponents(prior, geocode.address),
      sourceMasterLocationId: null,
      latitude: geocode.latitude,
      longitude: geocode.longitude,
      geocodeSource: geocode.source,
      geocodeConfidence: geocode.confidence,
      geocodeRoadMatched: geocode.roadMatched,
      geocodeExpiresAt: geocode.expiresAt,
      geocodedAt: now,
      validatedAt: null,
      status: 'GEOCODED',
      updatedAt: now,
    };
  },

  /** Renewed coordinates (a cached Google geocode refreshed). Status unchanged. */
  regeocoded(prior: Location, geocode: LocationGeocode, now: Date): Location {
    return {
      ...withComponents(prior, geocode.address),
      latitude: geocode.latitude,
      longitude: geocode.longitude,
      geocodeSource: geocode.source,
      geocodeConfidence: geocode.confidence,
      geocodeRoadMatched: geocode.roadMatched,
      geocodeExpiresAt: geocode.expiresAt,
      geocodedAt: now,
      updatedAt: now,
    };
  },

  /** Cached third-party coordinates expired without a refresh: drop them, back to PENDING. */
  geocodeExpired(prior: Location, now: Date): Location {
    return { ...prior, ...NO_GEOCODE, status: 'PENDING', updatedAt: now };
  },

  /** GEOCODED → VALIDATED (operator or auto-approval). */
  approved(prior: Location, now: Date): Location {
    return { ...prior, status: 'VALIDATED', validatedAt: now, updatedAt: now };
  },

  /** * → REJECTED. */
  rejected(prior: Location, now: Date): Location {
    return { ...prior, status: 'REJECTED', updatedAt: now };
  },

  /** A delivery capture for this address landed further away than it should. */
  captureDisagrees(
    prior: Location,
    capture: { readonly masterLocationId: MasterLocationId; readonly distanceM: number },
    now: Date,
  ): Location {
    return {
      ...prior,
      captureMasterLocationId: capture.masterLocationId,
      captureDistanceM: capture.distanceM,
      captureReview: 'DISAGREES',
      updatedAt: now,
    };
  },

  /** An operator dealt with the capture disagreement. */
  captureReviewCleared(prior: Location, now: Date): Location {
    return { ...prior, captureReview: null, updatedAt: now };
  },
} as const;

/** Whether a location's coordinates may become one of our master locations. */
export function isOwnGeocode(location: Location): boolean {
  return location.geocodeSource === 'PHOTON' || location.geocodeSource === 'OPERATOR';
}
