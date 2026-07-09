import { z } from 'zod';

/**
 * Command for transitioning a job `accepted` → `completed`. Issued from the
 * mobile offline queue; idempotent like accept-job. `note` is optional
 * free-text carried on the domain event for audit context.
 */
export const CompleteJobCommandSchema = z
  .object({
    jobId: z.string().min(1).max(40),
    note: z.string().max(2000).optional(),
  })
  .strict();

export type CompleteJobCommand = z.infer<typeof CompleteJobCommandSchema>;
