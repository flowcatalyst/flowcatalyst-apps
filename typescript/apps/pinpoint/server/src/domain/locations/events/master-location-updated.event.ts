import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const MasterLocationUpdatedDataSchema = Type.Object({
  masterLocationId: Type.String(),
  clientId: Type.String(),
  /** New address_hash after the manual edit (may have changed if components shifted). */
  addressHash: Type.String(),
});

export type MasterLocationUpdatedData = Static<typeof MasterLocationUpdatedDataSchema>;

/**
 * Emitted when a master location's normalized components are edited via
 * the BFF "edit master" form. Triggers downstream consumers to refresh
 * cached views; child locations are not re-validated by this event
 * (that's `confirm-master-location`).
 */
export class MasterLocationUpdated extends BaseDomainEvent<MasterLocationUpdatedData> {
  constructor(scope: Scope, data: MasterLocationUpdatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'master_location', 'updated'),
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

export const MasterLocationUpdatedEventType = {
  code: 'pinpoint:locations:master_location:updated',
  name: 'Master Location Updated',
  description: 'A master location had its normalized components manually edited.',
  payloadSchema: MasterLocationUpdatedDataSchema,
} as const;
