import {
  createAggregateHandler,
  type AggregateRegistryImpl,
} from '@flowcatalyst-apps/app-framework';
import { JOB_TYPE, type Job } from '../domain/jobs/job.js';
import type { JobRepository } from '../domain/jobs/job.repository.js';

/**
 * Wire the Job aggregate into the shared AggregateRegistry so use cases
 * calling `commitAggregate(job, ...)` resolve to this repository at
 * persist time.
 */
export function registerJob(registry: AggregateRegistryImpl, repository: JobRepository): void {
  registry.register(createAggregateHandler<Job>(JOB_TYPE, repository));
}
