import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * The pick context accepted a create-pick command and registered the work
 * item. The fulfilment process manager (future) keys part transitions off
 * pick events like this one.
 */
export const PickCreatedDataSchema = Type.Object({
  pickId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  fulfilmentId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
});

export type PickCreatedData = Static<typeof PickCreatedDataSchema>;

export class PickCreated extends BaseDomainEvent<PickCreatedData> {
  constructor(scope: Scope, data: PickCreatedData) {
    super(
      {
        eventType: DomainEvent.eventType('fulfil-go', 'pick', 'pick', 'created'),
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

export const PickCreatedEventType = {
  code: 'fulfil-go:pick:pick:created',
  name: 'Pick Created',
  description: 'The pick context registered a pick for a fulfilment part.',
  payloadSchema: PickCreatedDataSchema,
} as const;
