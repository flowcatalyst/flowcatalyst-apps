/**
 * BFF client shape shared by list/get.
 *
 * Each schema carries an `$id` and is registered via `SHARED_SCHEMAS` so it
 * appears under `components.schemas` in OpenAPI; routes use the `*Ref` export.
 */
import { Type } from '@sinclair/typebox';
import { schemaRef } from '../../../plugins/schema-ref.js';

/** A client as the BFF returns it. */
export const BffClientSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    code: Type.String(),
    status: Type.String(),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'BffClient' },
);
export const BffClientRef = schemaRef(BffClientSchema);
