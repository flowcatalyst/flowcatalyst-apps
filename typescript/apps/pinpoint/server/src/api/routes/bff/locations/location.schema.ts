/**
 * BFF location summary — the list row; the detail route intersects it with
 * the editable/received address fields and the feature associations.
 *
 * Registered via `SHARED_SCHEMAS` → `components.schemas.BffLocationSummary`.
 */
import { Type } from '@sinclair/typebox';
import { schemaRef } from '../../../plugins/schema-ref.js';

export const BffLocationSummarySchema = Type.Object(
  {
    id: Type.String(),
    name: Type.Union([Type.String(), Type.Null()]),
    partitionId: Type.Union([Type.String(), Type.Null()]),
    address: Type.String(),
    city: Type.String(),
    country: Type.String(),
    status: Type.String(),
    masterLocationId: Type.Union([Type.String(), Type.Null()]),
    matchConfidence: Type.Union([Type.Number(), Type.Null()]),
    /** How the master was matched: EXACT_HASH | FUZZY | null (no match). */
    matchMethod: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'BffLocationSummary' },
);
export const BffLocationSummaryRef = schemaRef(BffLocationSummarySchema);
