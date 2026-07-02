import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LocationDeletedDataSchema = Type.Object({
  locationId: Type.String(),
  clientId: Type.String(),
  masterLocationId: Type.Union([Type.String(), Type.Null()]),
});

export type LocationDeletedData = Static<typeof LocationDeletedDataSchema>;

export class LocationDeleted extends BaseDomainEvent<LocationDeletedData> {
  constructor(scope: Scope, data: LocationDeletedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'location', 'deleted'),
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

export const LocationDeletedEventType = {
  code: 'pinpoint:locations:location:deleted',
  name: 'Location Deleted',
  description:
    'A location was deleted (cascades to its feature, attribute, and layer association rows).',
  payloadSchema: LocationDeletedDataSchema,
} as const;
