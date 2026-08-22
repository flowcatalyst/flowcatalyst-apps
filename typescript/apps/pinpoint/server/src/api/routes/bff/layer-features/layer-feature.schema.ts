/**
 * BFF layer-feature shapes shared by list/get/create/update/set-status.
 *
 * Each schema carries an `$id` and is registered via `SHARED_SCHEMAS` so it
 * appears under `components.schemas` in OpenAPI; routes use the `*Ref` export.
 */
import { Type } from '@sinclair/typebox';
import { schemaRef } from '../../../plugins/schema-ref.js';

/** A layer feature as the BFF returns it. */
export const BffLayerFeatureSchema = Type.Object(
  {
    id: Type.String(),
    layerId: Type.String(),
    label: Type.String(),
    centerLat: Type.Union([Type.Number(), Type.Null()]),
    centerLon: Type.Union([Type.Number(), Type.Null()]),
    radiusMeters: Type.Union([Type.Number(), Type.Null()]),
    polygonGeojson: Type.Union([Type.String(), Type.Null()]),
    propertyValues: Type.Record(Type.String(), Type.String()),
    status: Type.String(),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'BffLayerFeature' },
);
export const BffLayerFeatureRef = schemaRef(BffLayerFeatureSchema);

/** Create/update payload for a layer feature. */
export const BffLayerFeatureInputSchema = Type.Object(
  {
    label: Type.String({ minLength: 1 }),
    centerLat: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    centerLon: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    radiusMeters: Type.Optional(Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()])),
    polygonGeojson: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    propertyValues: Type.Optional(Type.Record(Type.String(), Type.String())),
  },
  { $id: 'BffLayerFeatureInput' },
);
export const BffLayerFeatureInputRef = schemaRef(BffLayerFeatureInputSchema);
