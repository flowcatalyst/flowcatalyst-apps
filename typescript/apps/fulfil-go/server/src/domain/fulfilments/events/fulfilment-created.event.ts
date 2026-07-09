import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * Source of truth for both the runtime payload type AND the JSON Schema
 * synced to FlowCatalyst. Carries what downstream contexts need to react
 * (the pick context keys create-pick to partIds) — full captured data is
 * fetched via the API when needed, not shipped on the event.
 */
export const FulfilmentCreatedDataSchema = Type.Object({
  fulfilmentId: Type.String(),
  clientId: Type.String(),
  externalSource: Type.String(),
  externalRef: Type.String(),
  type: Type.String(),
  serviceLevel: Type.String(),
  slotStart: Type.String(),
  slotEnd: Type.String(),
  parts: Type.Array(
    Type.Object({
      partId: Type.String(),
      shortId: Type.String(),
      originRef: Type.String(),
    }),
  ),
});

export type FulfilmentCreatedData = Static<typeof FulfilmentCreatedDataSchema>;

export class FulfilmentCreated extends BaseDomainEvent<FulfilmentCreatedData> {
  constructor(scope: Scope, data: FulfilmentCreatedData) {
    super(
      {
        eventType: DomainEvent.eventType('fulfil-go', 'fulfilment', 'fulfilment', 'created'),
        specVersion: '1.0',
        source: 'fulfil-go:fulfilment',
        subject: DomainEvent.subject('fulfilment', 'fulfilment', data.fulfilmentId),
        messageGroup: eventGroup('fulfilment', data.fulfilmentId),
      },
      scope as never,
      data,
    );
  }
}

export const FulfilmentCreatedEventType = {
  code: 'fulfil-go:fulfilment:fulfilment:created',
  name: 'Fulfilment Created',
  description: 'A fulfil-go fulfilment was created with its parts.',
  payloadSchema: FulfilmentCreatedDataSchema,
} as const;
