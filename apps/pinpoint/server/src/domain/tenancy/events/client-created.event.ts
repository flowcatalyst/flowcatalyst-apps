import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export interface ClientCreatedData {
  readonly clientId: string;
  readonly name: string;
  readonly code: string;
}

export class ClientCreated extends BaseDomainEvent<ClientCreatedData> {
  constructor(scope: Scope, data: ClientCreatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'tenancy', 'client', 'created'),
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
