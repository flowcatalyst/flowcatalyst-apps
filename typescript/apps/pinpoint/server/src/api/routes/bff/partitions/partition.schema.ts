/**
 * BFF partition shape shared by list/get/create/update.
 *
 * Each schema carries an `$id` and is registered via `SHARED_SCHEMAS` so it
 * appears under `components.schemas` in OpenAPI; routes use the `*Ref` export.
 */
import { Type } from '@sinclair/typebox';
import { schemaRef } from '../../../plugins/schema-ref.js';

/** A partition as the BFF returns it. */
export const BffPartitionSchema = Type.Object(
  {
    id: Type.String(),
    code: Type.String(),
    name: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'BffPartition' },
);
export const BffPartitionRef = schemaRef(BffPartitionSchema);
