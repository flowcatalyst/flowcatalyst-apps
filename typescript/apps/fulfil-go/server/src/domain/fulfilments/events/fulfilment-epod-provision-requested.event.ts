import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * The fulfilment process manager decided EPOD needs pre-provisioning for
 * this fulfilment (an origin store lists 'epod' as an execution system) and
 * created the provisioning dispatch job. Emitted in the SAME tx as the
 * dispatch job + the 'epod-provision-dispatched' guard log entry — the fact
 * that makes the integration decision observable on the platform.
 */
export const FulfilmentEpodProvisionRequestedDataSchema = Type.Object({
  fulfilmentId: Type.String(),
  clientId: Type.String(),
  /** Origin store refs whose settings selected EPOD. */
  originRefs: Type.Array(Type.String()),
});

export type FulfilmentEpodProvisionRequestedData = Static<
  typeof FulfilmentEpodProvisionRequestedDataSchema
>;

export class FulfilmentEpodProvisionRequested extends BaseDomainEvent<FulfilmentEpodProvisionRequestedData> {
  constructor(scope: Scope, data: FulfilmentEpodProvisionRequestedData) {
    super(
      {
        eventType: DomainEvent.eventType(
          'fulfil-go',
          'fulfilment',
          'fulfilment',
          'epod-provision-requested',
        ),
        specVersion: '1.0',
        source: 'fulfil-go:fulfilment',
        subject: DomainEvent.subject('fulfilment', 'fulfilment', data.fulfilmentId),
        messageGroup: eventGroup('fulfilment', data.fulfilmentId),
      },
      scope as never,
      data,
    );
  }
}

export const FulfilmentEpodProvisionRequestedEventType = {
  code: 'fulfil-go:fulfilment:fulfilment:epod-provision-requested',
  name: 'Fulfilment EPOD Provision Requested',
  description:
    'The process manager dispatched EPOD master-data provisioning (destination + products) for a fulfilment.',
  payloadSchema: FulfilmentEpodProvisionRequestedDataSchema,
} as const;
