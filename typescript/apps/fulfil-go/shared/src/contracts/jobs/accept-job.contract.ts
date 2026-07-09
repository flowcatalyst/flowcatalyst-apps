import { z } from 'zod';

/**
 * Command for transitioning a job `assigned` → `accepted`. Issued from the
 * mobile offline queue, so it must stay idempotent: accepting an already
 * accepted job (same assignee) is a no-op success, not an error.
 */
export const AcceptJobCommandSchema = z
  .object({
    jobId: z.string().min(1).max(40),
  })
  .strict();

export type AcceptJobCommand = z.infer<typeof AcceptJobCommandSchema>;
