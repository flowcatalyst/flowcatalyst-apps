import { asc, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
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
  return {
    async persist(aggregate: Job, tx?: TransactionContext): Promise<Job> {
      const client = resolveDb(db, tx);
      const [row] = await client
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
        .onConflictDoUpdate({
          target: jobs.id,
          set: {
            status: aggregate.status,
            title: aggregate.title,
            details: aggregate.details,
            assigneeId: aggregate.assigneeId,
            assignedAt: aggregate.assignedAt,
            acceptedAt: aggregate.acceptedAt,
            completedAt: aggregate.completedAt,
            version: aggregate.version,
            updatedAt: aggregate.updatedAt,
          },
        })
        .returning();

      if (!row) throw new Error(`Job persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: Job, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client.delete(jobs).where(eq(jobs.id, aggregate.id)).returning();
      return rows.length > 0;
    },

    async findById(id: JobId): Promise<Job | null> {
      const [row] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
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
