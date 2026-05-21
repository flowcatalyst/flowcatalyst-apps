import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const PartitionDeletedDataSchema = Type.Object({
  partitionId: Type.String(),
  clientId: Type.String(),
});

export type PartitionDeletedData = Static<typeof PartitionDeletedDataSchema>;

export class PartitionDeleted extends BaseDomainEvent<PartitionDeletedData> {
  constructor(scope: Scope, data: PartitionDeletedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'tenancy', 'partition', 'deleted'),
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

export const PartitionDeletedEventType = {
  code: 'pinpoint:tenancy:partition:deleted',
  name: 'Partition Deleted',
  description: 'A partition was deleted.',
  payloadSchema: PartitionDeletedDataSchema,
} as const;
