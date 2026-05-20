import type { LayerFeatureId, LayerId } from './ids.js';

export const LAYER_FEATURE_TYPE = 'LayerFeature' as const;

export type LayerFeatureStatus = 'ACTIVE' | 'INACTIVE';

/**
 * Layer feature property bag. The Rust pipeline caps this at 6 keys —
 * the constraint is enforced at the use-case layer (`PROPERTY_VALUES_MAX`)
 * rather than via a check constraint, matching how the Rust domain
 * validates it.
 */
export type LayerFeatureProperties = Readonly<Record<string, string>>;

export const PROPERTY_VALUES_MAX = 6;

export interface LayerFeature {
  readonly id: LayerFeatureId;
  readonly layerId: LayerId;
  readonly label: string;
  readonly centerLat: number | null;
  readonly centerLon: number | null;
  readonly radiusMeters: number | null;
  readonly polygonGeojson: string | null;
  readonly propertyValues: LayerFeatureProperties;
  readonly status: LayerFeatureStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateLayerFeatureInput {
  readonly id: LayerFeatureId;
  readonly layerId: LayerId;
  readonly label: string;
  readonly centerLat: number | null;
  readonly centerLon: number | null;
  readonly radiusMeters: number | null;
  readonly polygonGeojson: string | null;
  readonly propertyValues: LayerFeatureProperties;
  readonly now: Date;
}

export interface UpdateLayerFeatureInput {
  readonly label: string;
  readonly centerLat: number | null;
  readonly centerLon: number | null;
  readonly radiusMeters: number | null;
  readonly polygonGeojson: string | null;
  readonly propertyValues: LayerFeatureProperties;
  readonly now: Date;
}

export const LayerFeature = {
  create(input: CreateLayerFeatureInput): LayerFeature {
    return {
      id: input.id,
      layerId: input.layerId,
      label: input.label,
      centerLat: input.centerLat,
      centerLon: input.centerLon,
      radiusMeters: input.radiusMeters,
      polygonGeojson: input.polygonGeojson,
      propertyValues: input.propertyValues,
      status: 'ACTIVE',
      createdAt: input.now,
      updatedAt: input.now,
    };
  },
  update(prior: LayerFeature, input: UpdateLayerFeatureInput): LayerFeature {
    return {
      ...prior,
      label: input.label,
      centerLat: input.centerLat,
      centerLon: input.centerLon,
      radiusMeters: input.radiusMeters,
      polygonGeojson: input.polygonGeojson,
      propertyValues: input.propertyValues,
      updatedAt: input.now,
    };
  },
} as const;
