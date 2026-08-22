import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const MasterLocationGeocodeConfirmedDataSchema = Type.Object({
  masterLocationId: Type.String(),
  clientId: Type.String(),
  houseNumber: Type.Union([Type.String(), Type.Null()]),
  road: Type.Union([Type.String(), Type.Null()]),
  suburb: Type.Union([Type.String(), Type.Null()]),
  city: Type.String(),
  state: Type.Union([Type.String(), Type.Null()]),
  postalCode: Type.Union([Type.String(), Type.Null()]),
  country: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number(),
  addressHash: Type.String(),
  normalizedAddressLine: Type.String(),
});
export type MasterLocationGeocodeConfirmedData = Static<
  typeof MasterLocationGeocodeConfirmedDataSchema
>;

export class MasterLocationGeocodeConfirmed extends BaseDomainEvent<MasterLocationGeocodeConfirmedData> {
  constructor(scope: Scope, data: MasterLocationGeocodeConfirmedData) {
    super(
      {
        eventType: DomainEvent.eventType(
          'pinpoint',
          'locations',
          'master_location',
          'geocode-confirmed',
        ),
        specVersion: '1.0',
        source: 'pinpoint:locations',
        subject: DomainEvent.subject('locations', 'master_location', data.masterLocationId),
        messageGroup: DomainEvent.messageGroup(
          'locations',
          'master_location',
          data.masterLocationId,
        ),
      },
      scope as never,
      data,
    );
  }
}

export const MasterLocationGeocodeConfirmedEventType = {
  code: 'pinpoint:locations:master_location:geocode-confirmed',
  name: 'Master Location Geocode Confirmed',
  description:
    'An operator confirmed a master location’s address components and coordinates (after reverse geocoding or manual entry); the master is GEOCODED and ready to confirm.',
  payloadSchema: MasterLocationGeocodeConfirmedDataSchema,
} as const;
