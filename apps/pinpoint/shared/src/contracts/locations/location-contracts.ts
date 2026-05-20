import { z } from 'zod';

/**
 * Minimal-create command for Slice 3. Takes raw address fields directly;
 * normalization and master-location matching come in later slices and
 * augment the persisted Location via separate use cases.
 */
export const CreateLocationCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  partitionId: z.string().trim().min(1).optional().nullable(),
  externalId: z.string().trim().min(1).optional().nullable(),
  name: z.string().trim().min(1).optional().nullable(),
  rawAddressLine1: z.string().trim().min(1),
  rawAddressLine2: z.string().trim().optional().nullable(),
  rawSuburb: z.string().trim().optional().nullable(),
  rawCity: z.string().trim().min(1),
  rawState: z.string().trim().optional().nullable(),
  rawPostalCode: z.string().trim().optional().nullable(),
  rawCountry: z.string().trim().min(1),
});
export type CreateLocationCommand = z.infer<typeof CreateLocationCommandSchema>;
