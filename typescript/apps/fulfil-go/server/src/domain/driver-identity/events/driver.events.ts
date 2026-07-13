import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * Driver identity events (`fulfil-go:transport:driver:*`) — provisioning and
 * lifecycle facts. No credentials on payloads; the PIN material never leaves
 * the server. `storeRef` = the driver's home depot.
 */
export const DriverCreatedDataSchema = Type.Object({
  driverId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  staffCode: Type.String(),
});
export type DriverCreatedData = Static<typeof DriverCreatedDataSchema>;

export const DriverLifecycleDataSchema = Type.Object({
  driverId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  staffCode: Type.String(),
});
export type DriverLifecycleData = Static<typeof DriverLifecycleDataSchema>;

export const DriverReassignedDataSchema = Type.Object({
  driverId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  previousStoreRef: Type.String(),
  staffCode: Type.String(),
});
export type DriverReassignedData = Static<typeof DriverReassignedDataSchema>;

function envelope(driverId: string, action: string) {
  return {
    eventType: DomainEvent.eventType('fulfil-go', 'transport', 'driver', action),
    specVersion: '1.0',
    source: 'fulfil-go:transport',
    subject: DomainEvent.subject('transport', 'driver', driverId),
    messageGroup: eventGroup('driver', driverId),
  };
}

export class DriverCreated extends BaseDomainEvent<DriverCreatedData> {
  constructor(scope: Scope, data: DriverCreatedData) {
    super(envelope(data.driverId, 'created'), scope as never, data);
  }
}
export class DriverSuspended extends BaseDomainEvent<DriverLifecycleData> {
  constructor(scope: Scope, data: DriverLifecycleData) {
    super(envelope(data.driverId, 'suspended'), scope as never, data);
  }
}
export class DriverReactivated extends BaseDomainEvent<DriverLifecycleData> {
  constructor(scope: Scope, data: DriverLifecycleData) {
    super(envelope(data.driverId, 'reactivated'), scope as never, data);
  }
}
export class DriverReassigned extends BaseDomainEvent<DriverReassignedData> {
  constructor(scope: Scope, data: DriverReassignedData) {
    super(envelope(data.driverId, 'reassigned'), scope as never, data);
  }
}
export class DriverDeleted extends BaseDomainEvent<DriverLifecycleData> {
  constructor(scope: Scope, data: DriverLifecycleData) {
    super(envelope(data.driverId, 'deleted'), scope as never, data);
  }
}

export const DriverCreatedEventType = {
  code: 'fulfil-go:transport:driver:created',
  name: 'Driver Created',
  description: 'A transport-context driver user was provisioned (staff code + PIN, depot-linked).',
  payloadSchema: DriverCreatedDataSchema,
} as const;
export const DriverSuspendedEventType = {
  code: 'fulfil-go:transport:driver:suspended',
  name: 'Driver Suspended',
  description: 'A driver was suspended — live sessions end within one access-token TTL.',
  payloadSchema: DriverLifecycleDataSchema,
} as const;
export const DriverReactivatedEventType = {
  code: 'fulfil-go:transport:driver:reactivated',
  name: 'Driver Reactivated',
  description: 'A suspended driver was reactivated.',
  payloadSchema: DriverLifecycleDataSchema,
} as const;
export const DriverReassignedEventType = {
  code: 'fulfil-go:transport:driver:reassigned',
  name: 'Driver Reassigned',
  description: 'A driver moved to another home depot.',
  payloadSchema: DriverReassignedDataSchema,
} as const;
export const DriverDeletedEventType = {
  code: 'fulfil-go:transport:driver:deleted',
  name: 'Driver Deleted',
  description: 'A driver user was removed.',
  payloadSchema: DriverLifecycleDataSchema,
} as const;
