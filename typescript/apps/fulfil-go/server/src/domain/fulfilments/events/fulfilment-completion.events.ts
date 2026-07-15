import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * THE COMPLETION LEG (docs/fulfilment-context.md): fulfilment-context
 * reactions to transport-order terminal outcomes (emitted by the process
 * manager, operations/fulfilment-transport-process). Part delivery facts for
 * integrators, plus the fulfilment terminals: completed (everything
 * delivered) and partially-completed (something delivered, something
 * failed — pick- or delivery-failed alike). An all-failed delivery leg
 * reuses fulfilment:failed. messageGroup = the FULFILMENT.
 */
function envelope(fulfilmentId: string, entity: 'part' | 'fulfilment', action: string) {
  return {
    eventType: DomainEvent.eventType('fulfil-go', 'fulfilment', entity, action),
    specVersion: '1.0',
    source: 'fulfil-go:fulfilment',
    subject: DomainEvent.subject('fulfilment', entity, fulfilmentId),
    messageGroup: eventGroup('fulfilment', fulfilmentId),
  };
}

export const PartDeliveryDataSchema = Type.Object({
  fulfilmentId: Type.String(),
  clientId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
  transportOrderId: Type.String(),
  provider: Type.String(),
  /** Present on delivery-failed. */
  reason: Type.Optional(Type.String()),
});
export type PartDeliveryData = Static<typeof PartDeliveryDataSchema>;

export const FulfilmentCompletionDataSchema = Type.Object({
  fulfilmentId: Type.String(),
  clientId: Type.String(),
  externalSource: Type.String(),
  externalRef: Type.String(),
  /** Every part that was in play (cancelled parts are omitted). */
  parts: Type.Array(
    Type.Object({
      partId: Type.String(),
      shortId: Type.String(),
      delivered: Type.Boolean(),
    }),
  ),
});
export type FulfilmentCompletionData = Static<typeof FulfilmentCompletionDataSchema>;

export class FulfilmentPartDelivered extends BaseDomainEvent<PartDeliveryData> {
  constructor(scope: Scope, data: PartDeliveryData) {
    super(envelope(data.fulfilmentId, 'part', 'delivered'), scope as never, data);
  }
}

export class FulfilmentPartDeliveryFailed extends BaseDomainEvent<PartDeliveryData> {
  constructor(scope: Scope, data: PartDeliveryData) {
    super(envelope(data.fulfilmentId, 'part', 'delivery-failed'), scope as never, data);
  }
}

export class FulfilmentCompleted extends BaseDomainEvent<FulfilmentCompletionData> {
  constructor(scope: Scope, data: FulfilmentCompletionData) {
    super(envelope(data.fulfilmentId, 'fulfilment', 'completed'), scope as never, data);
  }
}

export class FulfilmentPartiallyCompleted extends BaseDomainEvent<FulfilmentCompletionData> {
  constructor(scope: Scope, data: FulfilmentCompletionData) {
    super(envelope(data.fulfilmentId, 'fulfilment', 'partially-completed'), scope as never, data);
  }
}

export const FulfilmentPartDeliveredEventType = {
  code: 'fulfil-go:fulfilment:part:delivered',
  name: 'Part Delivered',
  description: 'The transport leg delivered this part to the destination.',
  payloadSchema: PartDeliveryDataSchema,
} as const;

export const FulfilmentPartDeliveryFailedEventType = {
  code: 'fulfil-go:fulfilment:part:delivery-failed',
  name: 'Part Delivery Failed',
  description: 'The transport leg for this part terminally failed or was cancelled.',
  payloadSchema: PartDeliveryDataSchema,
} as const;

export const FulfilmentCompletedEventType = {
  code: 'fulfil-go:fulfilment:fulfilment:completed',
  name: 'Fulfilment Completed',
  description: 'Every part that was in play was delivered.',
  payloadSchema: FulfilmentCompletionDataSchema,
} as const;

export const FulfilmentPartiallyCompletedEventType = {
  code: 'fulfil-go:fulfilment:fulfilment:partially-completed',
  name: 'Fulfilment Partially Completed',
  description:
    'Delivery finished with a mix of outcomes: something was delivered, something failed (pick or delivery).',
  payloadSchema: FulfilmentCompletionDataSchema,
} as const;
