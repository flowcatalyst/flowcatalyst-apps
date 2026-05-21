import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export interface LocationCreatedData {
  readonly locationId: string;
  readonly clientId: string;
  readonly partitionId: string | null;
  /**
   * Master the location matched to (or freshly created). Always present
   * in the Slice 8 pipeline; the field is on the event so downstream
   * consumers don't need to refetch the location row to learn it.
   */
  readonly masterLocationId: string;
  readonly externalId: string | null;
  readonly rawCity: string;
  readonly rawCountry: string;
}

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
