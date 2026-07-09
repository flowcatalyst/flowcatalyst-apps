import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { Job } from './job.js';
import type { JobId } from './ids.js';

export interface JobRepository {
  persist(aggregate: Job, tx?: TransactionContext): Promise<Job>;
  delete(aggregate: Job, tx?: TransactionContext): Promise<boolean>;

  findById(id: JobId): Promise<Job | null>;
  /** Jobs currently assigned to a principal — the mobile app's working set. */
  listByAssignee(assigneeId: string): Promise<readonly Job[]>;
  /** Dispatcher view — newest first. */
  listAll(limit: number, offset: number): Promise<readonly Job[]>;
}
