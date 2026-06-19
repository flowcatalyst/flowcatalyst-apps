import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const MasterLocationValidatedDataSchema = Type.Object({
  masterLocationId: Type.String(),
  clientId: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number(),
  /** Locations cascaded to VALIDATED by this confirmation. */
  locationsValidated: Type.Integer({ minimum: 0 }),
  /** Spatial feature matches found at this coordinate. */
  featuresMatched: Type.Integer({ minimum: 0 }),
});

export type MasterLocationValidatedData = Static<typeof MasterLocationValidatedDataSchema>;

/**
 * Emitted by `confirm-master-location`. * → VALIDATED. Triggers the
 * LocationValidated cascade for child locations.
 */
export class MasterLocationValidated extends BaseDomainEvent<MasterLocationValidatedData> {
  constructor(scope: Scope, data: MasterLocationValidatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'master_location', 'validated'),
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

export const MasterLocationValidatedEventType = {
  code: 'pinpoint:locations:master_location:validated',
  name: 'Master Location Validated',
  description:
    'A master location was marked canonical and its child locations cascaded to VALIDATED.',
  payloadSchema: MasterLocationValidatedDataSchema,
} as const;
