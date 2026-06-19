import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const ClientUpdatedDataSchema = Type.Object({
  clientId: Type.String(),
  name: Type.String(),
  code: Type.String(),
});

export type ClientUpdatedData = Static<typeof ClientUpdatedDataSchema>;

export class ClientUpdated extends BaseDomainEvent<ClientUpdatedData> {
  constructor(scope: Scope, data: ClientUpdatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'tenancy', 'client', 'updated'),
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

export const ClientUpdatedEventType = {
  code: 'pinpoint:tenancy:client:updated',
  name: 'Client Updated',
  description: 'A pinpoint tenancy client had its name updated.',
  payloadSchema: ClientUpdatedDataSchema,
} as const;
