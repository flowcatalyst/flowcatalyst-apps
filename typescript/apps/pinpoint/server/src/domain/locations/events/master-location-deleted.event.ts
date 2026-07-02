import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const MasterLocationDeletedDataSchema = Type.Object({
  masterLocationId: Type.String(),
  clientId: Type.String(),
  /** Number of child locations deleted as part of this cascade. */
  locationsDeleted: Type.Integer({ minimum: 0 }),
});

export type MasterLocationDeletedData = Static<typeof MasterLocationDeletedDataSchema>;

export class MasterLocationDeleted extends BaseDomainEvent<MasterLocationDeletedData> {
  constructor(scope: Scope, data: MasterLocationDeletedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'master_location', 'deleted'),
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

export const MasterLocationDeletedEventType = {
  code: 'pinpoint:locations:master_location:deleted',
  name: 'Master Location Deleted',
  description:
    'A master location was deleted (cascades to its child locations and processing-log rows).',
  payloadSchema: MasterLocationDeletedDataSchema,
} as const;
