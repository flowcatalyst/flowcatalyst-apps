import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export interface MasterLocationCreatedData {
  readonly masterLocationId: string;
  readonly clientId: string;
  readonly partitionId: string | null;
  readonly addressHash: string;
  readonly normalizedCity: string;
  readonly normalizedCountry: string;
}

export class MasterLocationCreated extends BaseDomainEvent<MasterLocationCreatedData> {
  constructor(scope: Scope, data: MasterLocationCreatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'master_location', 'created'),
        specVersion: '1.0',
        source: 'pinpoint:locations',
        subject: DomainEvent.subject('locations', 'master_location', data.masterLocationId),
        messageGroup: DomainEvent.messageGroup('locations', 'master_location', data.masterLocationId),
      },
      scope as never,
      data,
    );
  }
}
