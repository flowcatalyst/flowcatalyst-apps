import { z } from 'zod';

/**
 * Untagged form matching the Rust `AttributeValue` enum — JSONB lets the
 * value be either a single string or an array of strings.
 */
export const AttributeValueSchema = z.union([z.string(), z.array(z.string())]);
export type AttributeValue = z.infer<typeof AttributeValueSchema>;

export const AttributeInputSchema = z.object({
  key: z.string().trim().min(1),
  value: AttributeValueSchema,
});
export type AttributeInput = z.infer<typeof AttributeInputSchema>;

/**
 * Slice 8 rewrites the command shape to match the Rust pipeline: a single
 * free-form `address` string + an optional `countryCode` retry hint. The
 * libpostal normalizer parses it on the way in; `raw_*` columns are
 * filled from the parsed components, not from caller-supplied structured
 * fields. The Slice 3 minimal-create shape is gone.
 *
 * Slice 10b.3 adds optional `attributes` (per-key/value rows persisted in
 * `location_attributes`). Mirrors the Rust create-location request.
 */
export const CreateLocationCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  partitionId: z.string().trim().min(1).optional().nullable(),
  externalId: z.string().trim().min(1).optional().nullable(),
  name: z.string().trim().min(1).optional().nullable(),
  address: z.string().trim().min(1),
  /**
   * Optional ISO-A3 country code (e.g. "ZAF"). If libpostal fails to
   * normalize the address, the matching pipeline retries with the
   * country code appended before giving up.
   */
  countryCode: z.string().trim().min(2).max(3).optional().nullable(),
  attributes: z.array(AttributeInputSchema).optional(),
});
export type CreateLocationCommand = z.infer<typeof CreateLocationCommandSchema>;

/**
 * Delete a location. Cascades (via DB FK ON DELETE CASCADE) to the location's
 * feature/attribute/layer association rows.
 */
export const DeleteLocationCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
});
export type DeleteLocationCommand = z.infer<typeof DeleteLocationCommandSchema>;
