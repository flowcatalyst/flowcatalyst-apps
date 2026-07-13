import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * Trip lifecycle events (`fulfil-go:transport:trip:*`) — the planning
 * context's marketplace facts. Grouped per trip. Order-level execution
 * facts stay on `fulfil-go:transport:order:*`.
 */
export const TripEventDataSchema = Type.Object({
  tripId: Type.String(),
  clientId: Type.String(),
  originRef: Type.String(),
  /** Our-planned channel the offer targets ('own' | 'epod'). */
  provider: Type.String(),
  driverRef: Type.String(),
  vehicleRef: Type.String(),
  transportOrderIds: Type.Array(Type.String()),
  partShortIds: Type.Array(Type.String()),
  /** Present on released. */
  reason: Type.Optional(Type.String()),
});

export type TripEventData = Static<typeof TripEventDataSchema>;

function envelope(action: string, data: TripEventData) {
  return {
    eventType: DomainEvent.eventType('fulfil-go', 'transport', 'trip', action),
    specVersion: '1.0',
    source: 'fulfil-go:transport',
    subject: DomainEvent.subject('transport', 'trip', data.tripId),
    messageGroup: eventGroup('trip', data.tripId),
  };
}

export class TripOffered extends BaseDomainEvent<TripEventData> {
  constructor(scope: Scope, data: TripEventData) {
    super(envelope('offered', data), scope as never, data);
  }
}
export class TripClaimed extends BaseDomainEvent<TripEventData> {
  constructor(scope: Scope, data: TripEventData) {
    super(envelope('claimed', data), scope as never, data);
  }
}
export class TripReleased extends BaseDomainEvent<TripEventData> {
  constructor(scope: Scope, data: TripEventData) {
    super(envelope('released', data), scope as never, data);
  }
}

function eventType(action: string, name: string, description: string) {
  return {
    code: `fulfil-go:transport:trip:${action}`,
    name,
    description,
    payloadSchema: TripEventDataSchema,
  } as const;
}

export const TripOfferedEventType = eventType(
  'offered',
  'Trip Offered',
  'A trip was composed and offered to a driver — its transport orders hold an expiring reservation.',
);
export const TripClaimedEventType = eventType(
  'claimed',
  'Trip Claimed',
  'The driver claimed the offered trip — its transport orders are booked/assigned to that driver.',
);
export const TripReleasedEventType = eventType(
  'released',
  'Trip Released',
  'An offered/claimed trip was released (route-plan rejection or explicit release) — its orders returned to the marketplace.',
);
