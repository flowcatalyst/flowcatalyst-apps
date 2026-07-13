import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * The process manager booked a TIMED transport request for a STANDARD
 * fulfilment (slotStart − transportLeadTime) — a fact event documenting the
 * deferred decision; the reactions sweep executes it at dueAt.
 */
export const FulfilmentTransportScheduledDataSchema = Type.Object({
  fulfilmentId: Type.String(),
  clientId: Type.String(),
  dueAt: Type.String(),
});

export type FulfilmentTransportScheduledData = Static<
  typeof FulfilmentTransportScheduledDataSchema
>;

export class FulfilmentTransportScheduled extends BaseDomainEvent<FulfilmentTransportScheduledData> {
  constructor(scope: Scope, data: FulfilmentTransportScheduledData) {
    super(
      {
        eventType: DomainEvent.eventType('fulfil-go', 'fulfilment', 'fulfilment', 'transport-scheduled'),
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

export const FulfilmentTransportScheduledEventType = {
  code: 'fulfil-go:fulfilment:fulfilment:transport-scheduled',
  name: 'Fulfilment Transport Scheduled',
  description:
    'A timed transport request was booked for a STANDARD fulfilment (executes at dueAt).',
  payloadSchema: FulfilmentTransportScheduledDataSchema,
} as const;
