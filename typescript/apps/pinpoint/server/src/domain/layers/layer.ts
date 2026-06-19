import type { ClientId } from '../tenancy/ids.js';
import type { LayerId } from './ids.js';

export const LAYER_TYPE = 'Layer' as const;

export type LayerKind = 'RADIUS' | 'POLYGON' | 'POINT';
export type LayerStatus = 'ACTIVE' | 'INACTIVE';

export interface Layer {
  readonly id: LayerId;
  readonly clientId: ClientId;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly layerType: LayerKind;
  readonly centerLat: number | null;
  readonly centerLon: number | null;
  readonly radiusMeters: number | null;
  readonly polygonGeojson: string | null;
  readonly status: LayerStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateLayerInput {
  readonly id: LayerId;
  readonly clientId: ClientId;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly layerType: LayerKind;
  readonly centerLat: number | null;
  readonly centerLon: number | null;
  readonly radiusMeters: number | null;
  readonly polygonGeojson: string | null;
  readonly now: Date;
}

export interface UpdateLayerInput {
  readonly name: string;
  readonly description: string | null;
  readonly centerLat: number | null;
  readonly centerLon: number | null;
  readonly radiusMeters: number | null;
  readonly polygonGeojson: string | null;
  readonly status: LayerStatus;
  readonly now: Date;
}

export const Layer = {
  create(input: CreateLayerInput): Layer {
    return {
      id: input.id,
      clientId: input.clientId,
      code: input.code,
      name: input.name,
      description: input.description,
      layerType: input.layerType,
      centerLat: input.centerLat,
      centerLon: input.centerLon,
      radiusMeters: input.radiusMeters,
      polygonGeojson: input.polygonGeojson,
      status: 'ACTIVE',
      createdAt: input.now,
      updatedAt: input.now,
    };
  },

  /** Update mutable fields. `code` + `layerType` stay immutable. */
  update(prior: Layer, input: UpdateLayerInput): Layer {
    return {
      ...prior,
      name: input.name,
      description: input.description,
      centerLat: input.centerLat,
      centerLon: input.centerLon,
      radiusMeters: input.radiusMeters,
      polygonGeojson: input.polygonGeojson,
      status: input.status,
      updatedAt: input.now,
    };
  },
} as const;
