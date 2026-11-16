/**
 * A location as both surfaces return it from the detail route and the
 * lifecycle actions (geocode, approve, confirm-geocode, reject, …): the
 * received + match address, the resolved components, its own coordinates
 * and their source, the master it copied (reference only), any delivery
 * capture disagreement, and its feature associations.
 *
 * Registered via `SHARED_SCHEMAS` → `components.schemas.LocationDetail`.
 */
import { Type } from '@sinclair/typebox';
import { LOCATION_GEOCODE_SOURCES, type Location } from '../../../domain/locations/location.js';
import type { FeatureAssociation } from '../../../domain/layers/layer-feature.repository.js';
import { schemaRef } from '../../plugins/schema-ref.js';
import { BffFeatureAssociationRef } from '../bff/locations/feature-association.schema.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
const NullableDate = Type.Union([Type.String({ format: 'date-time' }), Type.Null()]);

export const LocationGeocodeSourceSchema = Type.Union([
  ...LOCATION_GEOCODE_SOURCES.map((s) => Type.Literal(s)),
  Type.Null(),
]);

/** A location's own geocode, for list rows and the canonical get. */
export const LocationGeocodeFields = {
  sourceMasterLocationId: NullableString,
  latitude: NullableNumber,
  longitude: NullableNumber,
  geocodeSource: LocationGeocodeSourceSchema,
  geocodeConfidence: NullableNumber,
  geocodeExpiresAt: NullableDate,
  validatedAt: NullableDate,
  captureReview: NullableString,
};

export function locationGeocodeFields(location: Location) {
  return {
    sourceMasterLocationId: location.sourceMasterLocationId,
    latitude: location.latitude,
    longitude: location.longitude,
    geocodeSource: location.geocodeSource,
    geocodeConfidence: location.geocodeConfidence,
    geocodeExpiresAt: location.geocodeExpiresAt?.toISOString() ?? null,
    validatedAt: location.validatedAt?.toISOString() ?? null,
    captureReview: location.captureReview,
  };
}

export const LocationDetailSchema = Type.Object(
  {
    id: Type.String(),
    clientId: Type.String(),
    partitionId: NullableString,
    externalId: NullableString,
    name: NullableString,
    /** PENDING | GEOCODED | VALIDATED | REJECTED. */
    status: Type.String(),
    /** Immutable received address (raw_address_line1). */
    receivedAddress: Type.String(),
    /** Editable match address that drives matching + geocoding. */
    matchAddress: Type.String(),
    /** Resolved components (from the master it copied, the geocoder, or an operator). */
    houseNumber: NullableString,
    road: NullableString,
    suburb: NullableString,
    city: NullableString,
    state: NullableString,
    postalCode: NullableString,
    country: NullableString,
    latitude: NullableNumber,
    longitude: NullableNumber,
    /** MASTER_LOCATIONS | PHOTON | GOOGLE_MAPS | OPERATOR. */
    geocodeSource: LocationGeocodeSourceSchema,
    geocodeConfidence: NullableNumber,
    geocodeRoadMatched: Type.Union([Type.Boolean(), Type.Null()]),
    /** Google coordinates are refreshed or deleted by then (30 days). */
    geocodeExpiresAt: NullableDate,
    geocodedAt: NullableDate,
    validatedAt: NullableDate,
    /** The master location whose data this location copied (reference only). */
    sourceMasterLocationId: NullableString,
    matchMethod: NullableString,
    matchConfidence: NullableNumber,
    /** DISAGREES when a delivery capture landed too far from these coordinates. */
    captureReview: NullableString,
    captureDistanceM: NullableNumber,
    /** The DRAFT master the disagreeing capture created. */
    captureMasterLocationId: NullableString,
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
    features: Type.Array(BffFeatureAssociationRef),
  },
  { $id: 'LocationDetail' },
);
export const LocationDetailRef = schemaRef(LocationDetailSchema);

export function toLocationDetail(location: Location, features: readonly FeatureAssociation[]) {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: location.id as string,
    clientId: location.clientId as string,
    partitionId: location.partitionId,
    externalId: location.externalId,
    name: location.name,
    status: location.status,
    receivedAddress: location.rawAddressLine1,
    matchAddress: location.matchAddress,
    houseNumber: location.normalizedHouseNumber,
    road: location.normalizedRoad,
    suburb: location.normalizedSuburb,
    city: location.normalizedCity,
    state: location.normalizedState,
    postalCode: location.normalizedPostalCode,
    country: location.normalizedCountry,
    latitude: location.latitude,
    longitude: location.longitude,
    geocodeSource: location.geocodeSource,
    geocodeConfidence: location.geocodeConfidence,
    geocodeRoadMatched: location.geocodeRoadMatched,
    geocodeExpiresAt: iso(location.geocodeExpiresAt),
    geocodedAt: iso(location.geocodedAt),
    validatedAt: iso(location.validatedAt),
    sourceMasterLocationId: location.sourceMasterLocationId,
    matchMethod: location.matchMethod,
    matchConfidence: location.matchConfidence,
    captureReview: location.captureReview,
    captureDistanceM: location.captureDistanceM,
    captureMasterLocationId: location.captureMasterLocationId,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
    features: [...features],
  };
}
