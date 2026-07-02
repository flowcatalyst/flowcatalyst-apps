import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LocationRematchedDataSchema = Type.Object({
  locationId: Type.String(),
  clientId: Type.String(),
  matchAddress: Type.String(),
  previousMasterLocationId: Type.Union([Type.String(), Type.Null()]),
  masterLocationId: Type.String(),
  status: Type.String(),
  /** True when the previous (PENDING, now-orphaned) master was deleted as part of this rematch. */
  previousMasterDeleted: Type.Boolean(),
});

export type LocationRematchedData = Static<typeof LocationRematchedDataSchema>;

export class LocationRematched extends BaseDomainEvent<LocationRematchedData> {
  constructor(scope: Scope, data: LocationRematchedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'location', 'rematched'),
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

export const LocationRematchedEventType = {
  code: 'pinpoint:locations:location:rematched',
  name: 'Location Rematched',
  description:
    "A location's match address was edited and matching re-run, re-pointing it to a master location (and deleting the previous orphaned PENDING master when applicable).",
  payloadSchema: LocationRematchedDataSchema,
} as const;
