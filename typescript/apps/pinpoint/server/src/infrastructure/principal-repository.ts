import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
import type { Principal, PrincipalDraft, PrincipalType } from '../domain/auth/principal.js';
import type {
  PrincipalRepository,
  PrincipalWithGrant,
} from '../domain/auth/principal.repository.js';
import { asPrincipalId, type PrincipalId } from '../domain/auth/ids.js';
import type { PartitionId } from '../domain/tenancy/ids.js';
import { principals, type PrincipalRow } from './schema/principals.js';
import { principalPartitions } from './schema/principal-partitions.js';

function toDomain(row: PrincipalRow): Principal {
  return {
    id: asPrincipalId(row.id),
    principalType: row.principalType as PrincipalType,
    name: row.name,
    email: row.email,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzlePrincipalRepository(db: PostgresJsDatabase): PrincipalRepository {
  return {
    async findById(id: PrincipalId): Promise<Principal | null> {
      const [row] = await db.select().from(principals).where(eq(principals.id, id)).limit(1);
      return row ? toDomain(row) : null;
    },

    async upsert(draft: PrincipalDraft): Promise<Principal> {
      const now = new Date();
      const [row] = await db
        .insert(principals)
        .values({
          id: draft.id,
          principalType: draft.principalType,
          name: draft.name,
          email: draft.email ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: principals.id,
          set: {
            principalType: draft.principalType,
            name: draft.name,
            email: draft.email ?? null,
            updatedAt: now,
          },
        })
        .returning();

      if (!row) {
        throw new Error(`Principal upsert returned no row for id=${draft.id}`);
      }
      return toDomain(row);
    },

    async findPrincipalsForPartition(
      partitionId: PartitionId,
    ): Promise<readonly PrincipalWithGrant[]> {
      const rows = await db
        .select({
          principal: principals,
          grantedAt: principalPartitions.grantedAt,
        })
        .from(principalPartitions)
        .innerJoin(principals, eq(principals.id, principalPartitions.principalId))
        .where(eq(principalPartitions.partitionId, partitionId))
        .orderBy(asc(principalPartitions.grantedAt));
      return rows.map((r) => ({
        principal: toDomain(r.principal),
        grantedAt: r.grantedAt,
      }));
    },

    async grantPartitionAccess(
      principalId: PrincipalId,
      partitionId: PartitionId,
      grantedBy: PrincipalId,
      tx?: TransactionContext,
    ): Promise<void> {
      const client = resolveDb(db, tx);
      await client
        .insert(principalPartitions)
        .values({
          principalId,
          partitionId,
          grantedBy,
          grantedAt: new Date(),
        })
        .onConflictDoNothing();
    },

    async revokePartitionAccess(
      principalId: PrincipalId,
      partitionId: PartitionId,
      tx?: TransactionContext,
    ): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client
        .delete(principalPartitions)
        .where(
          and(
            eq(principalPartitions.principalId, principalId),
            eq(principalPartitions.partitionId, partitionId),
          ),
        )
        .returning();
      return rows.length > 0;
    },
  };
}
