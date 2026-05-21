import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

/**
 * Source of truth for both the runtime payload type AND the JSON Schema
 * we sync to FlowCatalyst. `Static<typeof Schema>` derives the TS type
 * so consumers can't drift from what's published.
 */
export const ClientCreatedDataSchema = Type.Object({
  clientId: Type.String(),
  name: Type.String(),
  code: Type.String(),
});

export type ClientCreatedData = Static<typeof ClientCreatedDataSchema>;

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

export const ClientCreatedEventType = {
  code: 'pinpoint:tenancy:client:created',
  name: 'Client Created',
  description: 'A pinpoint tenancy client was created.',
  payloadSchema: ClientCreatedDataSchema,
} as const;
