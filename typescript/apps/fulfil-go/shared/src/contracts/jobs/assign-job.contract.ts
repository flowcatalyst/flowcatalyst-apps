import { z } from 'zod';

/**
 * Command for transitioning a job `created` → `assigned`. The assignee is a
 * principal id; the resulting event is pushed to that principal's SSE channel.
 */
export const AssignJobCommandSchema = z
  .object({
    jobId: z.string().min(1).max(40),
    assigneeId: z.string().min(1).max(64),
  })
  .strict();

export type AssignJobCommand = z.infer<typeof AssignJobCommandSchema>;
