import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

const NullableString = Type.Union([Type.String(), Type.Null()]);

export const MasterLocationCapturedDataSchema = Type.Object({
  masterLocationId: Type.String(),
  clientId: Type.String(),
  partitionId: NullableString,
  latitude: Type.Number(),
  longitude: Type.Number(),
  accuracyMeters: Type.Union([Type.Number(), Type.Null()]),
  capturedAt: Type.String({ format: 'date-time' }),
  /** The location the capture was matched to by address, if any. */
  locationId: NullableString,
  /** Distance from that location's coordinates, when it has some. */
  distanceMeters: Type.Union([Type.Number(), Type.Null()]),
  /** True when that distance is beyond the capture's tolerance (location flagged). */
  disagrees: Type.Boolean(),
});

export type MasterLocationCapturedData = Static<typeof MasterLocationCapturedDataSchema>;

/**
 * A delivery vehicle captured coordinates for an address: a DRAFT master location whose address
 * still has to be captured properly.
 */
export class MasterLocationCaptured extends BaseDomainEvent<MasterLocationCapturedData> {
  constructor(scope: Scope, data: MasterLocationCapturedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'master_location', 'captured'),
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

export const MasterLocationCapturedEventType = {
  code: 'pinpoint:locations:master_location:captured',
  name: 'Master Location Captured',
  description: "A delivery capture created a DRAFT master location.",
  payloadSchema: MasterLocationCapturedDataSchema,
} as const;
