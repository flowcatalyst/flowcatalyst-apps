import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LocationRematchedDataSchema = Type.Object({
  locationId: Type.String(),
  clientId: Type.String(),
  matchAddress: Type.String(),
  /** The master the location's data was copied from before the rematch (reference). */
  previousSourceMasterLocationId: Type.Union([Type.String(), Type.Null()]),
  /** The master it matched now — null: no match, back to PENDING to be geocoded. */
  sourceMasterLocationId: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
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
