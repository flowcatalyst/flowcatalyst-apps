import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

const NullableString = Type.Union([Type.String(), Type.Null()]);

export const LocationCreatedDataSchema = Type.Object({
  locationId: Type.String(),
  clientId: Type.String(),
  partitionId: NullableString,
  /**
   * The master location whose data the location copied, when it matched one
   * (reference only). Null: no match — the location is geocoded on its own.
   */
  sourceMasterLocationId: NullableString,
  /** VALIDATED when it matched a master, else PENDING. */
  status: Type.String(),
  externalId: NullableString,
  rawCity: Type.String(),
  rawCountry: Type.String(),
});

export type LocationCreatedData = Static<typeof LocationCreatedDataSchema>;

export class LocationCreated extends BaseDomainEvent<LocationCreatedData> {
  constructor(scope: Scope, data: LocationCreatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'location', 'created'),
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

export const LocationCreatedEventType = {
  code: 'pinpoint:locations:location:created',
  name: 'Location Created',
  description: 'A raw-address location was captured (matched or pending matching).',
  payloadSchema: LocationCreatedDataSchema,
} as const;
