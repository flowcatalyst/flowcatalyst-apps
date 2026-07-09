import type { JobStatus } from '@fulfil-go/shared';
import type { JobId } from './ids.js';

export const JOB_TYPE = 'Job' as const;

/**
 * The demo-vertical aggregate: created → assigned → accepted → completed.
 * Deliberately thin — it exists to exercise SSE push, offline-queued
 * transitions and telemetry end-to-end. `version` is bumped on every
 * transition for optimistic concurrency at persist time.
 */
export interface Job {
  readonly id: JobId;
  readonly status: JobStatus;
  readonly title: string;
  readonly details: string | null;
  readonly assigneeId: string | null;
  readonly assignedAt: Date | null;
  readonly acceptedAt: Date | null;
  readonly completedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateJobInput {
  readonly id: JobId;
  readonly title: string;
  readonly details: string | null;
  readonly now: Date;
}

export const Job = {
  create(input: CreateJobInput): Job {
    return {
      id: input.id,
      status: 'created',
      title: input.title,
      details: input.details,
      assigneeId: null,
      assignedAt: null,
      acceptedAt: null,
      completedAt: null,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
  },

  assign(prior: Job, assigneeId: string, now: Date): Job {
    return {
      ...prior,
      status: 'assigned',
      assigneeId,
      assignedAt: now,
      version: prior.version + 1,
      updatedAt: now,
    };
  },

  accept(prior: Job, now: Date): Job {
    return {
      ...prior,
      status: 'accepted',
      acceptedAt: now,
      version: prior.version + 1,
      updatedAt: now,
    };
  },

  complete(prior: Job, now: Date): Job {
    return {
      ...prior,
      status: 'completed',
      completedAt: now,
      version: prior.version + 1,
      updatedAt: now,
    };
  },
} as const;
