import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const MasterLocationCreatedDataSchema = Type.Object({
  masterLocationId: Type.String(),
  clientId: Type.String(),
  partitionId: Type.Union([Type.String(), Type.Null()]),
  addressHash: Type.String(),
  normalizedCity: Type.String(),
  normalizedCountry: Type.String(),
});

export type MasterLocationCreatedData = Static<typeof MasterLocationCreatedDataSchema>;

export class MasterLocationCreated extends BaseDomainEvent<MasterLocationCreatedData> {
  constructor(scope: Scope, data: MasterLocationCreatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'master_location', 'created'),
        specVersion: '1.0',
        source: 'pinpoint:locations',
        subject: DomainEvent.subject('locations', 'master_location', data.masterLocationId),
        messageGroup: DomainEvent.messageGroup(
          'locations',
          'master_location',
          data.masterLocationId,
        ),
      },
      scope as never,
      data,
    );
  }
}

export const MasterLocationCreatedEventType = {
  code: 'pinpoint:locations:master_location:created',
  name: 'Master Location Created',
  description: 'A new canonical master_location was created (no existing match found).',
  payloadSchema: MasterLocationCreatedDataSchema,
} as const;
