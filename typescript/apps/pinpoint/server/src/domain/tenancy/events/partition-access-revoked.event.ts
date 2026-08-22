import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const PartitionAccessRevokedDataSchema = Type.Object({
  partitionId: Type.String(),
  clientId: Type.String(),
  principalId: Type.String(),
  revokedBy: Type.String(),
});
export type PartitionAccessRevokedData = Static<typeof PartitionAccessRevokedDataSchema>;

export class PartitionAccessRevoked extends BaseDomainEvent<PartitionAccessRevokedData> {
  constructor(scope: Scope, data: PartitionAccessRevokedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'tenancy', 'partition', 'access-revoked'),
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

export const PartitionAccessRevokedEventType = {
  code: 'pinpoint:tenancy:partition:access-revoked',
  name: 'Partition Access Revoked',
  description: 'A principal’s access to a partition was revoked.',
  payloadSchema: PartitionAccessRevokedDataSchema,
} as const;
