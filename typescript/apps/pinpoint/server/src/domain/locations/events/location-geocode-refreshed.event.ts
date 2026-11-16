import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LocationGeocodeRefreshedDataSchema = Type.Object({
  locationId: Type.String(),
  clientId: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number(),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  source: Type.Union([Type.Literal('PHOTON'), Type.Literal('GOOGLE_MAPS'), Type.Literal('OPERATOR')]),
  expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

export type LocationGeocodeRefreshedData = Static<typeof LocationGeocodeRefreshedDataSchema>;

/**
 * A cached third-party geocode on a location was renewed before it expired.
 */
export class LocationGeocodeRefreshed extends BaseDomainEvent<LocationGeocodeRefreshedData> {
  constructor(scope: Scope, data: LocationGeocodeRefreshedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'location', 'geocode_refreshed'),
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

export const LocationGeocodeRefreshedEventType = {
  code: 'pinpoint:locations:location:geocode_refreshed',
  name: 'Location Geocode Refreshed',
  description: "A cached third-party geocode on a location was renewed before it expired.",
  payloadSchema: LocationGeocodeRefreshedDataSchema,
} as const;
