import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

const NullableString = Type.Union([Type.String(), Type.Null()]);

export const LocationRejectedDataSchema = Type.Object({
  locationId: Type.String(),
  clientId: Type.String(),
  reason: NullableString,
});

export type LocationRejectedData = Static<typeof LocationRejectedDataSchema>;

/**
 * An operator rejected a location (not a real or deliverable place).
 */
export class LocationRejected extends BaseDomainEvent<LocationRejectedData> {
  constructor(scope: Scope, data: LocationRejectedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'location', 'rejected'),
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

export const LocationRejectedEventType = {
  code: 'pinpoint:locations:location:rejected',
  name: 'Location Rejected',
  description: "An operator rejected a location.",
  payloadSchema: LocationRejectedDataSchema,
} as const;
