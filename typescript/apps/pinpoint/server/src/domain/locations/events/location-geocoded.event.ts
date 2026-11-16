import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';
import { AddressDetailsSchema } from './address-details.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);

export const LocationGeocodedDataSchema = Type.Object({
  locationId: Type.String(),
  clientId: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number(),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  formattedAddress: NullableString,
  /** The components the geocoder matched. */
  address: AddressDetailsSchema,
  /** Which geocoder produced the coordinates. */
  source: Type.Union([Type.Literal('PHOTON'), Type.Literal('GOOGLE_MAPS'), Type.Literal('OPERATOR')]),
  /** Cached third-party coordinates are refreshed or deleted by then (Google: 30 days). */
  expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

export type LocationGeocodedData = Static<typeof LocationGeocodedDataSchema>;

/**
 * Emitted by `geocode-location`: PENDING → GEOCODED.
 */
export class LocationGeocoded extends BaseDomainEvent<LocationGeocodedData> {
  constructor(scope: Scope, data: LocationGeocodedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'location', 'geocoded'),
        specVersion: '1.0',
        source: 'pinpoint:locations',
        subject: DomainEvent.subject('locations', 'location', data.locationId),
        messageGroup: DomainEvent.messageGroup('locations', 'location', data.locationId),
      },
      scope as never,
      data,
    );
  }
}

export const LocationGeocodedEventType = {
  code: 'pinpoint:locations:location:geocoded',
  name: 'Location Geocoded',
  description: "A location was resolved to coordinates (PENDING → GEOCODED).",
  payloadSchema: LocationGeocodedDataSchema,
} as const;
