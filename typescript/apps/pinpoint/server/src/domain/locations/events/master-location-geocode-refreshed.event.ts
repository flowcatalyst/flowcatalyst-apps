import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const MasterLocationGeocodeRefreshedDataSchema = Type.Object({
  masterLocationId: Type.String(),
  clientId: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number(),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  /** Which geocoder produced the refreshed coordinates. */
  source: Type.Union([Type.Literal('PHOTON'), Type.Literal('GOOGLE_MAPS')]),
  /** When these coordinates must be refreshed again (null = ours to keep). */
  expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

export type MasterLocationGeocodeRefreshedData = Static<
  typeof MasterLocationGeocodeRefreshedDataSchema
>;

/**
 * Emitted by `refresh-master-location-geocode` when a cached third-party
 * geocode is renewed before it expires. Status is unchanged.
 */
export class MasterLocationGeocodeRefreshed extends BaseDomainEvent<MasterLocationGeocodeRefreshedData> {
  constructor(scope: Scope, data: MasterLocationGeocodeRefreshedData) {
    super(
      {
        eventType: DomainEvent.eventType(
          'pinpoint',
          'locations',
          'master_location',
          'geocode_refreshed',
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

export const MasterLocationGeocodeRefreshedEventType = {
  code: 'pinpoint:locations:master_location:geocode_refreshed',
  name: 'Master Location Geocode Refreshed',
  description: 'A cached third-party geocode on a master location was renewed before it expired.',
  payloadSchema: MasterLocationGeocodeRefreshedDataSchema,
} as const;
