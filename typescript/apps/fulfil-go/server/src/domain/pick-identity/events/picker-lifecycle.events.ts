import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * Picker lifecycle events — suspend/reactivate/reassign/delete. One payload
 * shape (`storeRef` = the CURRENT store; reassignment also carries the
 * previous one) keeps the catalogue small; the event type is the verb.
 */
export const PickerLifecycleDataSchema = Type.Object({
  pickerId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  staffCode: Type.String(),
});
export type PickerLifecycleData = Static<typeof PickerLifecycleDataSchema>;

export const PickerReassignedDataSchema = Type.Object({
  pickerId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  previousStoreRef: Type.String(),
  staffCode: Type.String(),
});
export type PickerReassignedData = Static<typeof PickerReassignedDataSchema>;

function envelope(pickerId: string, action: string) {
  return {
    eventType: DomainEvent.eventType('fulfil-go', 'pick', 'picker', action),
    specVersion: '1.0',
    source: 'fulfil-go:pick',
    subject: DomainEvent.subject('pick', 'picker', pickerId),
    messageGroup: eventGroup('picker', pickerId),
  };
}

export class PickerSuspended extends BaseDomainEvent<PickerLifecycleData> {
  constructor(scope: Scope, data: PickerLifecycleData) {
    super(envelope(data.pickerId, 'suspended'), scope as never, data);
  }
}

export class PickerReactivated extends BaseDomainEvent<PickerLifecycleData> {
  constructor(scope: Scope, data: PickerLifecycleData) {
    super(envelope(data.pickerId, 'reactivated'), scope as never, data);
  }
}

export class PickerReassigned extends BaseDomainEvent<PickerReassignedData> {
  constructor(scope: Scope, data: PickerReassignedData) {
    super(envelope(data.pickerId, 'reassigned'), scope as never, data);
  }
}

export class PickerDeleted extends BaseDomainEvent<PickerLifecycleData> {
  constructor(scope: Scope, data: PickerLifecycleData) {
    super(envelope(data.pickerId, 'deleted'), scope as never, data);
  }
}
