import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const PartitionAccessGrantedDataSchema = Type.Object({
  partitionId: Type.String(),
  clientId: Type.String(),
  principalId: Type.String(),
  grantedBy: Type.String(),
});
export type PartitionAccessGrantedData = Static<typeof PartitionAccessGrantedDataSchema>;

export class PartitionAccessGranted extends BaseDomainEvent<PartitionAccessGrantedData> {
  constructor(scope: Scope, data: PartitionAccessGrantedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'tenancy', 'partition', 'access-granted'),
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

export const PartitionAccessGrantedEventType = {
  code: 'pinpoint:tenancy:partition:access-granted',
  name: 'Partition Access Granted',
  description: 'A principal was granted access to a partition.',
  payloadSchema: PartitionAccessGrantedDataSchema,
} as const;
