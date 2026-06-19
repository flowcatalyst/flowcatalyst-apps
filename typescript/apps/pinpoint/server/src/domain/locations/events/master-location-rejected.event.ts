import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const MasterLocationRejectedDataSchema = Type.Object({
  masterLocationId: Type.String(),
  clientId: Type.String(),
  /** Free-form reason captured at reject-time for the audit trail. */
  reason: Type.Union([Type.String(), Type.Null()]),
});

export type MasterLocationRejectedData = Static<typeof MasterLocationRejectedDataSchema>;

/**
 * Emitted by `reject-master-location` — marks a master as not a real
 * place (junk address, duplicate, manual override). Child locations
 * stay PENDING; the matching pipeline filters REJECTED masters out
 * of candidate lookups.
 */
export class MasterLocationRejected extends BaseDomainEvent<MasterLocationRejectedData> {
  constructor(scope: Scope, data: MasterLocationRejectedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'master_location', 'rejected'),
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

export const MasterLocationRejectedEventType = {
  code: 'pinpoint:locations:master_location:rejected',
  name: 'Master Location Rejected',
  description: 'A master location was manually rejected (junk address, duplicate, or override).',
  payloadSchema: MasterLocationRejectedDataSchema,
} as const;
