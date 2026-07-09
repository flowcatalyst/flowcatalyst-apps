import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * A part was released for picking (the FACT — broadcast). The COMMAND to the
 * pick context travels separately as a create-pick dispatch job created in
 * the same transaction.
 */
export const FulfilmentPartPickRequestedDataSchema = Type.Object({
  fulfilmentId: Type.String(),
  clientId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
  originRef: Type.String(),
  /** True when released after slotEnd (always-release policy; logged late). */
  releasedLate: Type.Boolean(),
});

export type FulfilmentPartPickRequestedData = Static<typeof FulfilmentPartPickRequestedDataSchema>;

export class FulfilmentPartPickRequested extends BaseDomainEvent<FulfilmentPartPickRequestedData> {
  constructor(scope: Scope, data: FulfilmentPartPickRequestedData) {
    super(
      {
        eventType: DomainEvent.eventType('fulfil-go', 'fulfilment', 'part', 'pick-requested'),
        specVersion: '1.0',
        source: 'fulfil-go:fulfilment',
        subject: DomainEvent.subject('fulfilment', 'part', data.partId),
        messageGroup: eventGroup('fulfilment', data.fulfilmentId),
      },
      scope as never,
      data,
    );
  }
}

export const FulfilmentPartPickRequestedEventType = {
  code: 'fulfil-go:fulfilment:part:pick-requested',
  name: 'Fulfilment Part Pick Requested',
  description: 'A fulfilment part was released to the pick context for picking.',
  payloadSchema: FulfilmentPartPickRequestedDataSchema,
} as const;
