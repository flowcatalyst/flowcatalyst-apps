import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * A picker was provisioned. No credentials on the payload — provisioning is an
 * audit-worthy fact; the PIN/QR material never leaves the server.
 */
export const PickerCreatedDataSchema = Type.Object({
  pickerId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  staffCode: Type.String(),
  primaryAuthMethod: Type.String(),
});

export type PickerCreatedData = Static<typeof PickerCreatedDataSchema>;

export class PickerCreated extends BaseDomainEvent<PickerCreatedData> {
  constructor(scope: Scope, data: PickerCreatedData) {
    super(
      {
        eventType: DomainEvent.eventType('fulfil-go', 'pick', 'picker', 'created'),
        specVersion: '1.0',
        source: 'fulfil-go:pick',
        subject: DomainEvent.subject('pick', 'picker', data.pickerId),
        messageGroup: eventGroup('picker', data.pickerId),
      },
      scope as never,
      data,
    );
  }
}

export const PickerCreatedEventType = {
  code: 'fulfil-go:pick:picker:created',
  name: 'Picker Created',
  description: 'A pick-context picker user was provisioned.',
  payloadSchema: PickerCreatedDataSchema,
} as const;
