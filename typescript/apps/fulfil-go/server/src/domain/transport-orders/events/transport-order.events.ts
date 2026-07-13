import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * Transport-order lifecycle events (`fulfil-go:transport:order:*`) — the
 * fulfilment process manager consumes these for the completion leg
 * (ready → completing → completed/partially_completed), and downstream
 * integrations track delivery through them. Grouped per transport order.
 */
export const TransportOrderEventDataSchema = Type.Object({
  transportOrderId: Type.String(),
  clientId: Type.String(),
  fulfilmentId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
  provider: Type.String(),
  providerRef: Type.Union([Type.String(), Type.Null()]),
  /** Present on failed/cancelled. */
  reason: Type.Optional(Type.String()),
});

export type TransportOrderEventData = Static<typeof TransportOrderEventDataSchema>;

function envelope(action: string, data: TransportOrderEventData) {
  return {
    eventType: DomainEvent.eventType('fulfil-go', 'transport', 'order', action),
    specVersion: '1.0',
    source: 'fulfil-go:transport',
    subject: DomainEvent.subject('transport', 'order', data.transportOrderId),
    messageGroup: eventGroup('transport-order', data.transportOrderId),
  };
}

export class TransportOrderRequested extends BaseDomainEvent<TransportOrderEventData> {
  constructor(scope: Scope, data: TransportOrderEventData) {
    super(envelope('requested', data), scope as never, data);
  }
}
export class TransportOrderBooked extends BaseDomainEvent<TransportOrderEventData> {
  constructor(scope: Scope, data: TransportOrderEventData) {
    super(envelope('booked', data), scope as never, data);
  }
}
export class TransportOrderAssigned extends BaseDomainEvent<TransportOrderEventData> {
  constructor(scope: Scope, data: TransportOrderEventData) {
    super(envelope('assigned', data), scope as never, data);
  }
}
export class TransportOrderCollected extends BaseDomainEvent<TransportOrderEventData> {
  constructor(scope: Scope, data: TransportOrderEventData) {
    super(envelope('collected', data), scope as never, data);
  }
}
export class TransportOrderDelivered extends BaseDomainEvent<TransportOrderEventData> {
  constructor(scope: Scope, data: TransportOrderEventData) {
    super(envelope('delivered', data), scope as never, data);
  }
}
export class TransportOrderFailed extends BaseDomainEvent<TransportOrderEventData> {
  constructor(scope: Scope, data: TransportOrderEventData) {
    super(envelope('failed', data), scope as never, data);
  }
}
export class TransportOrderCancelled extends BaseDomainEvent<TransportOrderEventData> {
  constructor(scope: Scope, data: TransportOrderEventData) {
    super(envelope('cancelled', data), scope as never, data);
  }
}

function eventType(action: string, name: string, description: string) {
  return {
    code: `fulfil-go:transport:order:${action}`,
    name,
    description,
    payloadSchema: TransportOrderEventDataSchema,
  } as const;
}

export const TransportOrderRequestedEventType = eventType(
  'requested',
  'Transport Order Requested',
  'A transport order was created for a picked fulfilment part (provider resolved, not yet executing).',
);
export const TransportOrderBookedEventType = eventType(
  'booked',
  'Transport Order Booked',
  'The provider accepted the booking (provider-planned) or a trip claimed the order (our-planned).',
);
export const TransportOrderAssignedEventType = eventType(
  'assigned',
  'Transport Order Assigned',
  'A courier/driver was assigned to the transport order.',
);
export const TransportOrderCollectedEventType = eventType(
  'collected',
  'Transport Order Collected',
  'The parcels were collected from the origin store.',
);
export const TransportOrderDeliveredEventType = eventType(
  'delivered',
  'Transport Order Delivered',
  'The parcels were delivered to the destination.',
);
export const TransportOrderFailedEventType = eventType(
  'failed',
  'Transport Order Failed',
  'The transport order terminally failed (no provider, provider failure, returned).',
);
export const TransportOrderCancelledEventType = eventType(
  'cancelled',
  'Transport Order Cancelled',
  'The transport order was cancelled before completion.',
);

/** Event class per normalized status — the webhook/status path indexes this. */
export const TRANSPORT_ORDER_EVENT_BY_STATUS = {
  booked: TransportOrderBooked,
  assigned: TransportOrderAssigned,
  collected: TransportOrderCollected,
  delivered: TransportOrderDelivered,
  failed: TransportOrderFailed,
  cancelled: TransportOrderCancelled,
} as const;
