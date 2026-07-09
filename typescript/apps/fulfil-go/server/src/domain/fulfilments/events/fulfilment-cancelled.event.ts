import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

export const FulfilmentCancelledDataSchema = Type.Object({
  fulfilmentId: Type.String(),
  clientId: Type.String(),
  externalSource: Type.String(),
  externalRef: Type.String(),
  reason: Type.Optional(Type.String()),
});

export type FulfilmentCancelledData = Static<typeof FulfilmentCancelledDataSchema>;

export class FulfilmentCancelled extends BaseDomainEvent<FulfilmentCancelledData> {
  constructor(scope: Scope, data: FulfilmentCancelledData) {
    super(
      {
        eventType: DomainEvent.eventType('fulfil-go', 'fulfilment', 'fulfilment', 'cancelled'),
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

export const FulfilmentCancelledEventType = {
  code: 'fulfil-go:fulfilment:fulfilment:cancelled',
  name: 'Fulfilment Cancelled',
  description: 'A fulfil-go fulfilment was cancelled (with all its parts).',
  payloadSchema: FulfilmentCancelledDataSchema,
} as const;
