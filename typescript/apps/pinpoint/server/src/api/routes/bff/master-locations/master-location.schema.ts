/**
 * BFF master-location summary shared by list/update/geocode/validate/confirm; the get route intersects it with `features`.
 *
 * Each schema carries an `$id` and is registered via `SHARED_SCHEMAS` so it
 * appears under `components.schemas` in OpenAPI; routes use the `*Ref` export.
 */
import { Type } from '@sinclair/typebox';
import { schemaRef } from '../../../plugins/schema-ref.js';

/** A master location as the BFF returns it (without feature associations). */
export const BffMasterLocationSchema = Type.Object(
  {
    id: Type.String(),
    address: Type.String(),
    houseNumber: Type.Union([Type.String(), Type.Null()]),
    road: Type.Union([Type.String(), Type.Null()]),
    suburb: Type.Union([Type.String(), Type.Null()]),
    city: Type.String(),
    state: Type.Union([Type.String(), Type.Null()]),
    postalCode: Type.Union([Type.String(), Type.Null()]),
    country: Type.String(),
    status: Type.String(),
    latitude: Type.Union([Type.Number(), Type.Null()]),
    longitude: Type.Union([Type.Number(), Type.Null()]),
    addressHash: Type.String(),
    createdAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'BffMasterLocation' },
);
export const BffMasterLocationRef = schemaRef(BffMasterLocationSchema);
