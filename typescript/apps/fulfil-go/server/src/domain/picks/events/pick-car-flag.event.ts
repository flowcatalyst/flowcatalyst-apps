import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * A supervisor flagged (or cleared) a pick's car-or-larger requirement
 * (Andrew, 2026-07-14: "requires a car or bigger — no bike/scooter"). For
 * picks still in flight the flag simply rides the completion actuals; for
 * COMPLETED picks the fulfilment PM consumes this to re-stamp the part —
 * while transport hasn't been requested yet (too-late updates ACK-log).
 */
export const PickCarFlagUpdatedDataSchema = Type.Object({
  pickId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  fulfilmentId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
  requiresCarOrLarger: Type.Boolean(),
  /** Pick status at flag time — the PM only acts on completed picks. */
  pickStatus: Type.String(),
});

export type PickCarFlagUpdatedData = Static<typeof PickCarFlagUpdatedDataSchema>;

export class PickCarFlagUpdated extends BaseDomainEvent<PickCarFlagUpdatedData> {
  constructor(scope: Scope, data: PickCarFlagUpdatedData) {
    super(
      {
        eventType: DomainEvent.eventType('fulfil-go', 'pick', 'pick', 'car-flag-updated'),
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

export const PickCarFlagUpdatedEventType = {
  code: 'fulfil-go:pick:pick:car-flag-updated',
  name: 'Pick Car Flag Updated',
  description: 'A supervisor flagged/cleared a pick as needing a car or bigger.',
  payloadSchema: PickCarFlagUpdatedDataSchema,
} as const;
