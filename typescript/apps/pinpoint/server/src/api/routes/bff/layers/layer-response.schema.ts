/**
 * Shared BFF layer detail response schema — used by get / create / update so
 * the three operations advertise the same shape in OpenAPI (the SPA assigns
 * any of them straight into its `LayerDetail` state).
 */
import { Type } from '@sinclair/typebox';

export const BffLayerPropertySchema = Type.Object({ key: Type.String(), value: Type.String() });

export const BffLayerPropertySetSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  properties: Type.Array(BffLayerPropertySchema),
});

export const BffLayerDetailResponseSchema = Type.Object({
  id: Type.String(),
  code: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  layerType: Type.Union([Type.Literal('RADIUS'), Type.Literal('POLYGON'), Type.Literal('POINT')]),
  status: Type.String(),
  centerLat: Type.Union([Type.Number(), Type.Null()]),
  centerLon: Type.Union([Type.Number(), Type.Null()]),
  radiusMeters: Type.Union([Type.Number(), Type.Null()]),
  polygonGeojson: Type.Union([Type.String(), Type.Null()]),
  propertySets: Type.Array(BffLayerPropertySetSchema),
  partitionIds: Type.Array(Type.String()),
  createdAt: Type.String({ format: 'date-time' }),
});
