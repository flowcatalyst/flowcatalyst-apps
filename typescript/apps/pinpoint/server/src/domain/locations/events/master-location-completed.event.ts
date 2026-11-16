import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';
import { AddressDetailsSchema } from './address-details.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);

export const MasterLocationCompletedDataSchema = Type.Object({
  masterLocationId: Type.String(),
  clientId: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number(),
  address: AddressDetailsSchema,
  name: NullableString,
});

export type MasterLocationCompletedData = Static<typeof MasterLocationCompletedDataSchema>;

/**
 * Someone captured the address of a DRAFT master location properly: DRAFT → VALIDATED, usable
 * for matching.
 */
export class MasterLocationCompleted extends BaseDomainEvent<MasterLocationCompletedData> {
  constructor(scope: Scope, data: MasterLocationCompletedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'master_location', 'completed'),
        specVersion: '1.0',
        source: 'pinpoint:locations',
        subject: DomainEvent.subject('locations', 'master_location', data.masterLocationId),
        messageGroup: DomainEvent.messageGroup('locations', 'master_location', data.masterLocationId),
      },
      scope as never,
      data,
    );
  }
}

export const MasterLocationCompletedEventType = {
  code: 'pinpoint:locations:master_location:completed',
  name: 'Master Location Completed',
  description: "The address of a DRAFT master location was captured; it is now VALIDATED.",
  payloadSchema: MasterLocationCompletedDataSchema,
} as const;
