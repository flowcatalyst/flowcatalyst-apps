import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export interface LayerPropertyValue {
  readonly key: string;
  readonly value: string;
}

export interface FeatureGeometry {
  readonly geometryType: string;
  readonly longitude: number | null;
  readonly latitude: number | null;
  readonly radiusMeters: number | null;
  readonly polygonPoints: readonly (readonly [number, number])[] | null;
}

export interface LayerPropertyAssignment {
  readonly layerId: string;
  readonly layerCode: string;
  readonly layerName: string;
  readonly layerType: string;
  readonly featureId: string;
  readonly featureLabel: string;
  readonly distanceMeters: number | null;
  readonly geometry: FeatureGeometry;
  readonly properties: readonly LayerPropertyValue[];
}

export interface LocationValidatedData {
  readonly locationId: string;
  readonly clientId: string;
  readonly masterLocationId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly layerProperties: readonly LayerPropertyAssignment[];
}

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
