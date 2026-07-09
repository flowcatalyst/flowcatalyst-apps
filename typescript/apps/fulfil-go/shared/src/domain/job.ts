import { z } from 'zod';

/**
 * Job lifecycle for the fulfil-go demo vertical. Deliberately thin: the
 * scaffold exists to exercise SSE push, offline-queued transitions and
 * telemetry end-to-end — richer on-demand domain modelling comes later.
 *
 * created → assigned → accepted → completed
 */
export const JobStatus = {
  Created: 'created',
  Assigned: 'assigned',
  Accepted: 'accepted',
  Completed: 'completed',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const JobStatusSchema = z.enum([
  JobStatus.Created,
  JobStatus.Assigned,
  JobStatus.Accepted,
  JobStatus.Completed,
]);

export const JobSchema = z
  .object({
    id: z.string().min(1).max(40),
    status: JobStatusSchema,
    title: z.string().min(1).max(200),
    details: z.string().max(4000).optional(),
    // Principal id of the driver/picker the job is assigned to.
    assigneeId: z.string().min(1).max(64).optional(),
    assignedAt: z.string().datetime().optional(),
    acceptedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();

export type Job = z.infer<typeof JobSchema>;
