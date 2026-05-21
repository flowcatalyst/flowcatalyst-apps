import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const ClientDeletedDataSchema = Type.Object({
  clientId: Type.String(),
  code: Type.String(),
});

export type ClientDeletedData = Static<typeof ClientDeletedDataSchema>;

export class ClientDeleted extends BaseDomainEvent<ClientDeletedData> {
  constructor(scope: Scope, data: ClientDeletedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'tenancy', 'client', 'deleted'),
        specVersion: '1.0',
        source: 'pinpoint:tenancy',
        subject: DomainEvent.subject('tenancy', 'client', data.clientId),
        messageGroup: DomainEvent.messageGroup('tenancy', 'client', data.clientId),
      },
      scope as never,
      data,
    );
  }
}

export const ClientDeletedEventType = {
  code: 'pinpoint:tenancy:client:deleted',
  name: 'Client Deleted',
  description: 'A pinpoint tenancy client was deleted.',
  payloadSchema: ClientDeletedDataSchema,
} as const;
