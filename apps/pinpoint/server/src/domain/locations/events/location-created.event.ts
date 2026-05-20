import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export interface LocationCreatedData {
  readonly locationId: string;
  readonly clientId: string;
  readonly partitionId: string | null;
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
