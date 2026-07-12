import { and, asc, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  TransactionStore,
  resolveDb,
  type TransactionContext,
} from '@flowcatalyst-apps/app-framework';
import { ConcurrencyConflictError } from '@fulfil-go/framework';
import type { JobStatus } from '@fulfil-go/shared';
import { asJobId, type JobId } from '../domain/jobs/ids.js';
import type { Job } from '../domain/jobs/job.js';
import type { JobRepository } from '../domain/jobs/job.repository.js';
import { jobs, type JobRow } from './schema/jobs.js';

function toDomain(row: JobRow): Job {
  return {
    id: asJobId(row.id),
    status: row.status as JobStatus,
    title: row.title,
    details: row.details,
    assigneeId: row.assigneeId,
    assignedAt: row.assignedAt,
    acceptedAt: row.acceptedAt,
    completedAt: row.completedAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleJobRepository(db: PostgresJsDatabase): JobRepository {
  // Reads join the ambient use-case tx (ALS) — see pick-repository for why.
  const current = () => resolveDb(db, TransactionStore.get());
  return {
    async persist(aggregate: Job, tx?: TransactionContext): Promise<Job> {
      const client = resolveDb(db, tx);
      let row: JobRow | undefined;
      if (aggregate.version === 1) {
        [row] = await client
          .insert(jobs)
          .values({
            id: aggregate.id,
            status: aggregate.status,
            title: aggregate.title,
            details: aggregate.details,
            assigneeId: aggregate.assigneeId,
            assignedAt: aggregate.assignedAt,
            acceptedAt: aggregate.acceptedAt,
            completedAt: aggregate.completedAt,
            version: aggregate.version,
            createdAt: aggregate.createdAt,
            updatedAt: aggregate.updatedAt,
          })
          .returning();
      } else {
        // Optimistic locking (house rule): guard on the prior version — a
        // racing assign/accept/complete loses with a 409, not last-writer-wins.
        [row] = await client
          .update(jobs)
          .set({
            status: aggregate.status,
            title: aggregate.title,
            details: aggregate.details,
            assigneeId: aggregate.assigneeId,
            assignedAt: aggregate.assignedAt,
            acceptedAt: aggregate.acceptedAt,
            completedAt: aggregate.completedAt,
            version: aggregate.version,
            updatedAt: aggregate.updatedAt,
          })
          .where(and(eq(jobs.id, aggregate.id), eq(jobs.version, aggregate.version - 1)))
          .returning();
        if (!row) {
          // Accept/complete replay idempotently by RE-COMMITTING UNCHANGED
          // (same version — the sealed Result means success must come from a
          // commit). A row already at exactly this version is that replay;
          // anything else is a real lost race → 409.
          const [existing] = await client
            .select()
            .from(jobs)
            .where(and(eq(jobs.id, aggregate.id), eq(jobs.version, aggregate.version)))
            .limit(1);
          if (existing) return toDomain(existing);
          throw new ConcurrencyConflictError('Job', aggregate.id, aggregate.version - 1);
        }
      }
      if (!row) throw new Error(`Job persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: Job, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client.delete(jobs).where(eq(jobs.id, aggregate.id)).returning();
      return rows.length > 0;
    },

    async findById(id: JobId): Promise<Job | null> {
      const [row] = await current().select().from(jobs).where(eq(jobs.id, id)).limit(1);
      return row ? toDomain(row) : null;
    },

    async listByAssignee(assigneeId: string): Promise<readonly Job[]> {
      const rows = await db
        .select()
        .from(jobs)
        .where(eq(jobs.assigneeId, assigneeId))
        .orderBy(asc(jobs.createdAt));
      return rows.map(toDomain);
    },

    async listAll(limit: number, offset: number): Promise<readonly Job[]> {
      const rows = await db
        .select()
        .from(jobs)
        .orderBy(desc(jobs.createdAt))
        .limit(limit)
        .offset(offset);
      return rows.map(toDomain);
    },
  };
}
