import { z } from 'zod';

/**
 * UpdateMatchingConfig command — sent via `PUT /matching-config`.
 *
 * Every threshold field is optional; only provided fields are applied,
 * mirroring Rust `UpdateMatchingConfigCommand`. Scope is determined by
 * `clientId` (required for non-global writes) + optional `partitionId`.
 * Editing the global default (both NULL) is intentionally not supported
 * from the API — it's seed data.
 */
const Threshold = z.number().min(0).max(1);

export const UpdateMatchingConfigCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  partitionId: z.string().trim().min(1).optional().nullable(),
  streetThreshold: Threshold.optional(),
  houseNumberThreshold: Threshold.optional(),
  postalCodeThreshold: Threshold.optional(),
  stateThreshold: Threshold.optional(),
  addressNameThreshold: Threshold.optional(),
  overallThreshold: Threshold.optional(),
});

export type UpdateMatchingConfigCommand = z.infer<typeof UpdateMatchingConfigCommandSchema>;
