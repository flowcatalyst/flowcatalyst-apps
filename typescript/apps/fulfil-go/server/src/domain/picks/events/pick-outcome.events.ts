import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * Pick OUTCOME events — what the fulfilment process manager (future) reacts
 * to: picked advances the part, short_picked advances it flagged short (only
 * possible when the fulfilment allowed partial fulfilment), failed triggers
 * the all-or-nothing policy decision. Payloads carry the line results so the
 * PM never has to read back into the pick context.
 */
export const PickOutcomeDataSchema = Type.Object({
  pickId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  fulfilmentId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
  pickerId: Type.String(),
  lineResults: Type.Array(
    Type.Object({ externalLineRef: Type.String(), pickedQuantity: Type.Integer() }),
  ),
  /** Packing output — what the handover/transport legs physically receive. */
  packages: Type.Array(
    Type.Object({
      ref: Type.String(),
      kind: Type.String(),
      size: Type.Union([Type.String(), Type.Null()]),
      temperature: Type.String(),
      items: Type.Union([
        Type.Array(Type.Object({ externalLineRef: Type.String(), quantity: Type.Integer() })),
        Type.Null(),
      ]),
    }),
  ),
});
export type PickOutcomeData = Static<typeof PickOutcomeDataSchema>;

export const PickFailedDataSchema = Type.Object({
  pickId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  fulfilmentId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
  pickerId: Type.String(),
  reason: Type.String(),
});
export type PickFailedData = Static<typeof PickFailedDataSchema>;

function envelope(pickId: string, action: string) {
  return {
    eventType: DomainEvent.eventType('fulfil-go', 'pick', 'pick', action),
    specVersion: '1.0',
    source: 'fulfil-go:pick',
    subject: DomainEvent.subject('pick', 'pick', pickId),
    messageGroup: eventGroup('pick', pickId),
  };
}

export class PickPicked extends BaseDomainEvent<PickOutcomeData> {
  constructor(scope: Scope, data: PickOutcomeData) {
    super(envelope(data.pickId, 'picked'), scope as never, data);
  }
}

export class PickShortPicked extends BaseDomainEvent<PickOutcomeData> {
  constructor(scope: Scope, data: PickOutcomeData) {
    super(envelope(data.pickId, 'short-picked'), scope as never, data);
  }
}

export class PickFailed extends BaseDomainEvent<PickFailedData> {
  constructor(scope: Scope, data: PickFailedData) {
    super(envelope(data.pickId, 'failed'), scope as never, data);
  }
}

export const PickPickedEventType = {
  code: 'fulfil-go:pick:pick:picked',
  name: 'Pick Picked',
  description: 'A pick completed in full.',
  payloadSchema: PickOutcomeDataSchema,
} as const;

export const PickShortPickedEventType = {
  code: 'fulfil-go:pick:pick:short-picked',
  name: 'Pick Short Picked',
  description: 'A pick completed short (allowed by the fulfilment policy).',
  payloadSchema: PickOutcomeDataSchema,
} as const;

export const PickFailedEventType = {
  code: 'fulfil-go:pick:pick:failed',
  name: 'Pick Failed',
  description: 'A picker could not fulfil the pick.',
  payloadSchema: PickFailedDataSchema,
} as const;
