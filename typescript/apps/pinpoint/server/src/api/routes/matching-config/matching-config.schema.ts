/**
 * Matching config shape shared by the canonical and BFF get/update routes.
 *
 * Each schema carries an `$id` and is registered via `SHARED_SCHEMAS` so it
 * appears under `components.schemas` in OpenAPI; routes use the `*Ref` export.
 */
import { Type } from '@sinclair/typebox';
import { schemaRef } from '../../plugins/schema-ref.js';

/** A matching configuration (global default or client override). */
export const MatchingConfigSchema = Type.Object(
  {
    id: Type.String(),
    clientId: Type.Union([Type.String(), Type.Null()]),
    partitionId: Type.Union([Type.String(), Type.Null()]),
    streetThreshold: Type.Number(),
    houseNumberThreshold: Type.Number(),
    postalCodeThreshold: Type.Number(),
    stateThreshold: Type.Number(),
    addressNameThreshold: Type.Number(),
    overallThreshold: Type.Number(),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'MatchingConfig' },
);
export const MatchingConfigRef = schemaRef(MatchingConfigSchema);
