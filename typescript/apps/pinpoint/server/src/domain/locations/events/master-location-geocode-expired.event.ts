import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const MasterLocationGeocodeExpiredDataSchema = Type.Object({
  masterLocationId: Type.String(),
  clientId: Type.String(),
  /** The source whose cached coordinates were dropped. */
  source: Type.Literal('GOOGLE_MAPS'),
  /** Why the refresh failed. */
  reason: Type.String(),
});

export type MasterLocationGeocodeExpiredData = Static<typeof MasterLocationGeocodeExpiredDataSchema>;

/**
 * Emitted when a cached third-party geocode reached its expiry without a
 * successful refresh: the coordinates are deleted and the master goes back to
 * PENDING. Consumers holding the old coordinates should drop them too.
 */
export class MasterLocationGeocodeExpired extends BaseDomainEvent<MasterLocationGeocodeExpiredData> {
  constructor(scope: Scope, data: MasterLocationGeocodeExpiredData) {
    super(
      {
        eventType: DomainEvent.eventType(
          'pinpoint',
          'locations',
          'master_location',
          'geocode_expired',
        ),
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

export const MasterLocationGeocodeExpiredEventType = {
  code: 'pinpoint:locations:master_location:geocode_expired',
  name: 'Master Location Geocode Expired',
  description:
    'A cached third-party geocode expired without a refresh; its coordinates were deleted and ' +
    'the master returned to PENDING.',
  payloadSchema: MasterLocationGeocodeExpiredDataSchema,
} as const;
