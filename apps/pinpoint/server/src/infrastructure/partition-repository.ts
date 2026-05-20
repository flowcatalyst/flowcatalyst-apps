import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
import { asClientId, asPartitionId, type ClientId, type PartitionId } from '../domain/tenancy/ids.js';
import type { Partition } from '../domain/tenancy/partition.js';
import type { PartitionRepository } from '../domain/tenancy/partition.repository.js';
import { partitions, type PartitionRow } from './schema/partitions.js';

function toDomain(row: PartitionRow): Partition {
  return {
    id: asPartitionId(row.id),
    clientId: asClientId(row.clientId),
    code: row.code,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzlePartitionRepository(db: PostgresJsDatabase): PartitionRepository {
  return {
    async persist(aggregate: Partition, tx?: TransactionContext): Promise<Partition> {
      const client = resolveDb(db, tx);
      const [row] = await client
        .insert(partitions)
        .values({
          id: aggregate.id,
          clientId: aggregate.clientId,
          code: aggregate.code,
          name: aggregate.name,
          description: aggregate.description,
          createdAt: aggregate.createdAt,
          updatedAt: aggregate.updatedAt,
        })
        .onConflictDoUpdate({
          target: partitions.id,
          set: {
            code: aggregate.code,
            name: aggregate.name,
            description: aggregate.description,
            updatedAt: aggregate.updatedAt,
          },
        })
        .returning();

      if (!row) throw new Error(`Partition persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: Partition, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client
        .delete(partitions)
        .where(eq(partitions.id, aggregate.id))
        .returning();
      return rows.length > 0;
    },

    async findById(id: PartitionId): Promise<Partition | null> {
      const [row] = await db.select().from(partitions).where(eq(partitions.id, id)).limit(1);
      return row ? toDomain(row) : null;
    },

    async findByClientAndCode(clientId: ClientId, code: string): Promise<Partition | null> {
      const [row] = await db
        .select()
        .from(partitions)
        .where(and(eq(partitions.clientId, clientId), eq(partitions.code, code)))
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async listByClient(clientId: ClientId): Promise<readonly Partition[]> {
      const rows = await db
        .select()
        .from(partitions)
        .where(eq(partitions.clientId, clientId))
        .orderBy(asc(partitions.name));
      return rows.map(toDomain);
    },
  };
}
