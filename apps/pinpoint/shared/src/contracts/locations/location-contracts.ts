import { z } from 'zod';

/**
 * Slice 8 rewrites the command shape to match the Rust pipeline: a single
 * free-form `address` string + an optional `countryCode` retry hint. The
 * libpostal normalizer parses it on the way in; `raw_*` columns are
 * filled from the parsed components, not from caller-supplied structured
 * fields. The Slice 3 minimal-create shape is gone.
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
});
export type CreateLocationCommand = z.infer<typeof CreateLocationCommandSchema>;
