import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LayerPropertyValueSchema = Type.Object({
  key: Type.String(),
  value: Type.String(),
});

export type LayerPropertyValue = Static<typeof LayerPropertyValueSchema>;

export const FeatureGeometrySchema = Type.Object({
  geometryType: Type.String(),
  longitude: Type.Union([Type.Number(), Type.Null()]),
  latitude: Type.Union([Type.Number(), Type.Null()]),
  radiusMeters: Type.Union([Type.Number(), Type.Null()]),
  polygonPoints: Type.Union([
    Type.Array(Type.Tuple([Type.Number(), Type.Number()])),
    Type.Null(),
  ]),
});

export type FeatureGeometry = Static<typeof FeatureGeometrySchema>;

export const LayerPropertyAssignmentSchema = Type.Object({
  layerId: Type.String(),
  layerCode: Type.String(),
  layerName: Type.String(),
  layerType: Type.String(),
  featureId: Type.String(),
  featureLabel: Type.String(),
  distanceMeters: Type.Union([Type.Number(), Type.Null()]),
  geometry: FeatureGeometrySchema,
  properties: Type.Array(LayerPropertyValueSchema),
});

export type LayerPropertyAssignment = Static<typeof LayerPropertyAssignmentSchema>;

export const LocationValidatedDataSchema = Type.Object({
  locationId: Type.String(),
  clientId: Type.String(),
  masterLocationId: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number(),
  layerProperties: Type.Array(LayerPropertyAssignmentSchema),
});

export type LocationValidatedData = Static<typeof LocationValidatedDataSchema>;

/**
 * Emitted when a location transitions to VALIDATED — either because its
 * master was confirmed (cascade), or because create-location matched it
 * to an already-VALIDATED master. Carries the spatial layer-property
 * payload downstream consumers use to enrich the location.
 */
export class LocationValidated extends BaseDomainEvent<LocationValidatedData> {
  constructor(scope: Scope, data: LocationValidatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'locations', 'location', 'validated'),
        specVersion: '1.0',
        source: 'pinpoint:locations',
        subject: DomainEvent.subject('locations', 'location', data.locationId),
        messageGroup: DomainEvent.messageGroup('locations', 'location', data.locationId),
      },
      scope as never,
      data,
    );
  }
}

export const LocationValidatedEventType = {
  code: 'pinpoint:locations:location:validated',
  name: 'Location Validated',
  description:
    'A location was marked VALIDATED. Carries layer-property assignments resolved from the master location coordinate.',
  payloadSchema: LocationValidatedDataSchema,
} as const;
