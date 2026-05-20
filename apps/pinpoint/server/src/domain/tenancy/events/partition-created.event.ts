import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export interface PartitionCreatedData {
  readonly partitionId: string;
  readonly clientId: string;
  readonly code: string;
  readonly name: string;
}

export class PartitionCreated extends BaseDomainEvent<PartitionCreatedData> {
  constructor(scope: Scope, data: PartitionCreatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'tenancy', 'partition', 'created'),
        specVersion: '1.0',
        source: 'pinpoint:tenancy',
        subject: DomainEvent.subject('tenancy', 'partition', data.partitionId),
        messageGroup: DomainEvent.messageGroup('tenancy', 'partition', data.partitionId),
      },
      scope as never,
      data,
    );
  }
}
