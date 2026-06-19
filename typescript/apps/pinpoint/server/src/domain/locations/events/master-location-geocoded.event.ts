import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const MasterLocationGeocodedDataSchema = Type.Object({
  masterLocationId: Type.String(),
  clientId: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number(),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  formattedAddress: Type.Union([Type.String(), Type.Null()]),
});

export type MasterLocationGeocodedData = Static<typeof MasterLocationGeocodedDataSchema>;

/**
 * Emitted by `validate-master-location` (which is the geocoding step,
 * despite the name). PENDING → GEOCODED.
 */
export class MasterLocationGeocoded extends BaseDomainEvent<MasterLocationGeocodedData> {
  constructor(scope: Scope, data: MasterLocationGeocodedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'master_location', 'geocoded'),
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

export const MasterLocationGeocodedEventType = {
  code: 'pinpoint:locations:master_location:geocoded',
  name: 'Master Location Geocoded',
  description: 'A master location was resolved to coordinates (PENDING → GEOCODED).',
  payloadSchema: MasterLocationGeocodedDataSchema,
} as const;
