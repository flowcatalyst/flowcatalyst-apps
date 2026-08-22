/**
 * Feature association (location ↔ layer feature) as embedded in BFF location + master-location detail.
 *
 * Each schema carries an `$id` and is registered via `SHARED_SCHEMAS` so it
 * appears under `components.schemas` in OpenAPI; routes use the `*Ref` export.
 */
import { Type } from '@sinclair/typebox';
import { schemaRef } from '../../../plugins/schema-ref.js';

/** A layer-feature association on a location / master location. */
export const BffFeatureAssociationSchema = Type.Object(
  {
    layerFeatureId: Type.String(),
    layerId: Type.String(),
    layerName: Type.String(),
    featureLabel: Type.String(),
    distanceMeters: Type.Union([Type.Number(), Type.Null()]),
  },
  { $id: 'BffFeatureAssociation' },
);
export const BffFeatureAssociationRef = schemaRef(BffFeatureAssociationSchema);
