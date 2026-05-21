import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const PartitionUpdatedDataSchema = Type.Object({
  partitionId: Type.String(),
  clientId: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
});

export type PartitionUpdatedData = Static<typeof PartitionUpdatedDataSchema>;

export class PartitionUpdated extends BaseDomainEvent<PartitionUpdatedData> {
  constructor(scope: Scope, data: PartitionUpdatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'tenancy', 'partition', 'updated'),
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

export const PartitionUpdatedEventType = {
  code: 'pinpoint:tenancy:partition:updated',
  name: 'Partition Updated',
  description: 'A partition had its name or description updated.',
  payloadSchema: PartitionUpdatedDataSchema,
} as const;
