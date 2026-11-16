import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LocationGeocodeExpiredDataSchema = Type.Object({
  locationId: Type.String(),
  clientId: Type.String(),
  /** The source whose cached coordinates were deleted. */
  source: Type.Literal('GOOGLE_MAPS'),
  reason: Type.String(),
});

export type LocationGeocodeExpiredData = Static<typeof LocationGeocodeExpiredDataSchema>;

/**
 * A cached third-party geocode expired without a refresh: coordinates and features deleted,
 * location back to PENDING. Consumers holding the coordinates should drop them too.
 */
export class LocationGeocodeExpired extends BaseDomainEvent<LocationGeocodeExpiredData> {
  constructor(scope: Scope, data: LocationGeocodeExpiredData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'location', 'geocode_expired'),
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

export const LocationGeocodeExpiredEventType = {
  code: 'pinpoint:locations:location:geocode_expired',
  name: 'Location Geocode Expired',
  description: "A cached third-party geocode on a location expired without a refresh; its coordinates were deleted and it returned to PENDING.",
  payloadSchema: LocationGeocodeExpiredDataSchema,
} as const;
