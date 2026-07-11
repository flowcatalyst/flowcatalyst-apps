import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * Fulfilment-context reactions to pick outcomes (emitted by the process
 * manager, operations/fulfilment-pick-process). Part-state changes are facts
 * integrators can follow; fulfilment:picked is the transport-request trigger
 * (ready), fulfilment:failed the all-or-nothing terminal.
 * messageGroup = the FULFILMENT — its lifecycle stays ordered.
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

export const PartPickProgressDataSchema = Type.Object({
  fulfilmentId: Type.String(),
  clientId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
  pickerId: Type.String(),
});
export type PartPickProgressData = Static<typeof PartPickProgressDataSchema>;

export const PartPickedDataSchema = Type.Object({
  fulfilmentId: Type.String(),
  clientId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
  pickerId: Type.String(),
  short: Type.Boolean(),
  requiresVehicle: Type.Boolean(),
  lineResults: Type.Array(
    Type.Object({
      externalLineRef: Type.String(),
      pickedQuantity: Type.Integer(),
      substitutions: Type.Optional(
        Type.Array(
          Type.Object({
            barcode: Type.String(),
            description: Type.Union([Type.String(), Type.Null()]),
            quantity: Type.Integer(),
          }),
        ),
      ),
    }),
  ),
});
export type PartPickedData = Static<typeof PartPickedDataSchema>;

export const PartFailedDataSchema = Type.Object({
  fulfilmentId: Type.String(),
  clientId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
  pickerId: Type.String(),
  reason: Type.String(),
});
export type PartFailedData = Static<typeof PartFailedDataSchema>;

export const FulfilmentPickedDataSchema = Type.Object({
  fulfilmentId: Type.String(),
  clientId: Type.String(),
  externalSource: Type.String(),
  externalRef: Type.String(),
  parts: Type.Array(
    Type.Object({ partId: Type.String(), shortId: Type.String(), short: Type.Boolean() }),
  ),
});
export type FulfilmentPickedData = Static<typeof FulfilmentPickedDataSchema>;

export const FulfilmentFailedDataSchema = Type.Object({
  fulfilmentId: Type.String(),
  clientId: Type.String(),
  externalSource: Type.String(),
  externalRef: Type.String(),
  reason: Type.String(),
});
export type FulfilmentFailedData = Static<typeof FulfilmentFailedDataSchema>;

export class FulfilmentPartPicking extends BaseDomainEvent<PartPickProgressData> {
  constructor(scope: Scope, data: PartPickProgressData) {
    super(envelope(data.fulfilmentId, 'part', 'picking'), scope as never, data);
  }
}

export class FulfilmentPartPicked extends BaseDomainEvent<PartPickedData> {
  constructor(scope: Scope, data: PartPickedData) {
    super(envelope(data.fulfilmentId, 'part', 'picked'), scope as never, data);
  }
}

export class FulfilmentPartFailed extends BaseDomainEvent<PartFailedData> {
  constructor(scope: Scope, data: PartFailedData) {
    super(envelope(data.fulfilmentId, 'part', 'failed'), scope as never, data);
  }
}

export class FulfilmentPicked extends BaseDomainEvent<FulfilmentPickedData> {
  constructor(scope: Scope, data: FulfilmentPickedData) {
    super(envelope(data.fulfilmentId, 'fulfilment', 'picked'), scope as never, data);
  }
}

export class FulfilmentFailed extends BaseDomainEvent<FulfilmentFailedData> {
  constructor(scope: Scope, data: FulfilmentFailedData) {
    super(envelope(data.fulfilmentId, 'fulfilment', 'failed'), scope as never, data);
  }
}

export const FulfilmentPartPickingEventType = {
  code: 'fulfil-go:fulfilment:part:picking',
  name: 'Part Picking Started',
  description: 'A picker claimed the pick for this part.',
  payloadSchema: PartPickProgressDataSchema,
} as const;

export const FulfilmentPartPickedEventType = {
  code: 'fulfil-go:fulfilment:part:picked',
  name: 'Part Picked',
  description: 'The pick for this part completed (short flag on the payload).',
  payloadSchema: PartPickedDataSchema,
} as const;

export const FulfilmentPartFailedEventType = {
  code: 'fulfil-go:fulfilment:part:failed',
  name: 'Part Pick Failed',
  description: 'The pick for this part could not be fulfilled.',
  payloadSchema: PartFailedDataSchema,
} as const;

export const FulfilmentPickedEventType = {
  code: 'fulfil-go:fulfilment:fulfilment:picked',
  name: 'Fulfilment Picked',
  description: 'Every viable part is picked — the fulfilment is ready for transport.',
  payloadSchema: FulfilmentPickedDataSchema,
} as const;

export const FulfilmentFailedEventType = {
  code: 'fulfil-go:fulfilment:fulfilment:failed',
  name: 'Fulfilment Failed',
  description: 'The fulfilment failed (all-or-nothing part failure, or no viable parts left).',
  payloadSchema: FulfilmentFailedDataSchema,
} as const;
