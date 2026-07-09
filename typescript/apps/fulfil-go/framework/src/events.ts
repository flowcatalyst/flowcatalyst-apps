/**
 * fulfil-go event-group convention: `${aggregateCode}-${aggregateId}` —
 * e.g. `fulfilment-ful_0QYFF4K9DX1XK`. Every domain event for the same
 * aggregate instance shares a group, so platform consumers process them in
 * order per aggregate. Use this for `messageGroup` on every BaseDomainEvent
 * instead of the SDK's colon-delimited `DomainEvent.messageGroup`.
 */
export function eventGroup(aggregateCode: string, aggregateId: string): string {
  return `${aggregateCode}-${aggregateId}`;
}
