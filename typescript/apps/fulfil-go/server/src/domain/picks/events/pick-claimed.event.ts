import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/** A picker claimed a requested pick at their store. */
export const PickClaimedDataSchema = Type.Object({
  pickId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  fulfilmentId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
  pickerId: Type.String(),
});

export type PickClaimedData = Static<typeof PickClaimedDataSchema>;

export class PickClaimed extends BaseDomainEvent<PickClaimedData> {
  constructor(scope: Scope, data: PickClaimedData) {
    super(
      {
        eventType: DomainEvent.eventType('fulfil-go', 'pick', 'pick', 'claimed'),
        specVersion: '1.0',
        source: 'fulfil-go:pick',
        subject: DomainEvent.subject('pick', 'pick', data.pickId),
        messageGroup: eventGroup('pick', data.pickId),
      },
      scope as never,
      data,
    );
  }
}

export const PickClaimedEventType = {
  code: 'fulfil-go:pick:pick:claimed',
  name: 'Pick Claimed',
  description: 'A picker claimed a requested pick at their store.',
  payloadSchema: PickClaimedDataSchema,
} as const;
