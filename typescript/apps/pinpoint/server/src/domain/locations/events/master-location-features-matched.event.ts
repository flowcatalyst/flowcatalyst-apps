import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const MasterLocationFeaturesMatchedDataSchema = Type.Object({
  masterLocationId: Type.String(),
  clientId: Type.String(),
  /** Child locations whose feature associations were replaced. */
  locationsUpdated: Type.Integer({ minimum: 0 }),
  features: Type.Array(
    Type.Object({
      layerFeatureId: Type.String(),
      layerId: Type.String(),
      layerName: Type.String(),
      featureLabel: Type.String(),
      distanceMeters: Type.Union([Type.Number(), Type.Null()]),
    }),
  ),
});
export type MasterLocationFeaturesMatchedData = Static<
  typeof MasterLocationFeaturesMatchedDataSchema
>;

export class MasterLocationFeaturesMatched extends BaseDomainEvent<MasterLocationFeaturesMatchedData> {
  constructor(scope: Scope, data: MasterLocationFeaturesMatchedData) {
    super(
      {
        eventType: DomainEvent.eventType(
          'pinpoint',
          'locations',
          'master_location',
          'features-matched',
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

export const MasterLocationFeaturesMatchedEventType = {
  code: 'pinpoint:locations:master_location:features-matched',
  name: 'Master Location Features Matched',
  description:
    'Layer features containing a master location’s point were (re)associated with all of its locations.',
  payloadSchema: MasterLocationFeaturesMatchedDataSchema,
} as const;
