import type { JobDto } from '@fulfil-go/shared';
import type { Job } from './job.js';

/** Aggregate → wire shape. Used by API responses, delta sync and SSE payloads. */
export function toJobDto(job: Job): JobDto {
  return {
    id: job.id,
    status: job.status,
    title: job.title,
    ...(job.details !== null ? { details: job.details } : {}),
    ...(job.assigneeId !== null ? { assigneeId: job.assigneeId } : {}),
    ...(job.assignedAt !== null ? { assignedAt: job.assignedAt.toISOString() } : {}),
    ...(job.acceptedAt !== null ? { acceptedAt: job.acceptedAt.toISOString() } : {}),
    ...(job.completedAt !== null ? { completedAt: job.completedAt.toISOString() } : {}),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
