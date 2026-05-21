import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const PartitionCreatedDataSchema = Type.Object({
  partitionId: Type.String(),
  clientId: Type.String(),
  code: Type.String(),
  name: Type.String(),
});

export type PartitionCreatedData = Static<typeof PartitionCreatedDataSchema>;

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

export const PartitionCreatedEventType = {
  code: 'pinpoint:tenancy:partition:created',
  name: 'Partition Created',
  description: 'A partition was created under a tenancy client.',
  payloadSchema: PartitionCreatedDataSchema,
} as const;
