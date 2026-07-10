import { z } from 'zod';

/**
 * Complete a claimed pick with per-line picked quantities. EVERY line of the
 * pick must be present (explicit zeros, no silent omissions); any quantity
 * below the ordered amount makes it a short pick — permitted only when the
 * pick's requireFullPick is false (the fulfilment allowed partial
 * fulfilment). `clientId`/`pickId` injected from the path.
 */
export const CompletePickCommandSchema = z
  .object({
    clientId: z.string().min(1).max(64),
    pickId: z.string().min(1).max(64),
    lines: z
      .array(
        z
          .object({
            externalLineRef: z.string().min(1).max(128),
            pickedQuantity: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type CompletePickCommand = z.infer<typeof CompletePickCommandSchema>;

/** The picker cannot fulfil a claimed pick — reason required. */
export const FailPickCommandSchema = z
  .object({
    clientId: z.string().min(1).max(64),
    pickId: z.string().min(1).max(64),
    reason: z.string().min(1).max(500),
  })
  .strict();
export type FailPickCommand = z.infer<typeof FailPickCommandSchema>;
