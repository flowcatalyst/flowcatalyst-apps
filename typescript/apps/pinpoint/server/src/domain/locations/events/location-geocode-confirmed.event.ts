import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';
import { AddressDetailsSchema } from './address-details.js';

export const LocationGeocodeConfirmedDataSchema = Type.Object({
  locationId: Type.String(),
  clientId: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number(),
  /** The components the operator confirmed. */
  address: AddressDetailsSchema,
});

export type LocationGeocodeConfirmedData = Static<typeof LocationGeocodeConfirmedDataSchema>;

/**
 * An operator supplied the coordinates and components for a location (source OPERATOR).
 */
export class LocationGeocodeConfirmed extends BaseDomainEvent<LocationGeocodeConfirmedData> {
  constructor(scope: Scope, data: LocationGeocodeConfirmedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'location', 'geocode_confirmed'),
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

export const LocationGeocodeConfirmedEventType = {
  code: 'pinpoint:locations:location:geocode_confirmed',
  name: 'Location Geocode Confirmed',
  description: "An operator confirmed the coordinates and address of a location.",
  payloadSchema: LocationGeocodeConfirmedDataSchema,
} as const;
