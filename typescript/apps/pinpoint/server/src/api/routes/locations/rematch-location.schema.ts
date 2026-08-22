/**
 * Rematch-location request/response shared by the canonical and BFF routes.
 *
 * Each schema carries an `$id` and is registered via `SHARED_SCHEMAS` so it
 * appears under `components.schemas` in OpenAPI; routes use the `*Ref` export.
 */
import { Type } from '@sinclair/typebox';
import { schemaRef } from '../../plugins/schema-ref.js';

/** Rematch request: the new match address. */
export const RematchLocationBodySchema = Type.Object(
  {
    matchAddress: Type.String({ minLength: 1 }),
  },
  { $id: 'RematchLocationBody' },
);
export const RematchLocationBodyRef = schemaRef(RematchLocationBodySchema);

/** Rematch outcome. */
export const RematchLocationResponseSchema = Type.Object(
  {
    locationId: Type.String(),
    masterLocationId: Type.String(),
    previousMasterLocationId: Type.Union([Type.String(), Type.Null()]),
    previousMasterDeleted: Type.Boolean(),
    status: Type.String(),
  },
  { $id: 'RematchLocationResponse' },
);
export const RematchLocationResponseRef = schemaRef(RematchLocationResponseSchema);
