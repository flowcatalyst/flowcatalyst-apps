import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
import {
  asClientId,
  asPartitionId,
  type ClientId,
  type PartitionId,
} from '../domain/tenancy/ids.js';
import { asMatchingConfigId, type MatchingConfigId } from '../domain/matching/ids.js';
import {
  MATCHING_CONFIG_DEFAULTS,
  type MatchingConfig,
} from '../domain/matching/matching-config.js';
import type { MatchingConfigRepository } from '../domain/matching/matching-config.repository.js';
import { matchingConfigs, type MatchingConfigRow } from './schema/matching-configs.js';

function toDomain(row: MatchingConfigRow): MatchingConfig {
  return {
    id: asMatchingConfigId(row.id),
    clientId: row.clientId != null ? asClientId(row.clientId) : null,
    partitionId: row.partitionId != null ? asPartitionId(row.partitionId) : null,
    streetThreshold: row.streetThreshold,
    houseNumberThreshold: row.houseNumberThreshold,
    postalCodeThreshold: row.postalCodeThreshold,
    stateThreshold: row.stateThreshold,
    addressNameThreshold: row.addressNameThreshold,
    overallThreshold: row.overallThreshold,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleMatchingConfigRepository(
  db: PostgresJsDatabase,
): MatchingConfigRepository {
  return {
    async persist(aggregate: MatchingConfig, tx?: TransactionContext): Promise<MatchingConfig> {
      const client = resolveDb(db, tx);
      const [row] = await client
        .insert(matchingConfigs)
        .values({
          id: aggregate.id,
          clientId: aggregate.clientId,
          partitionId: aggregate.partitionId,
          streetThreshold: aggregate.streetThreshold,
          houseNumberThreshold: aggregate.houseNumberThreshold,
          postalCodeThreshold: aggregate.postalCodeThreshold,
          stateThreshold: aggregate.stateThreshold,
          addressNameThreshold: aggregate.addressNameThreshold,
          overallThreshold: aggregate.overallThreshold,
          createdAt: aggregate.createdAt,
          updatedAt: aggregate.updatedAt,
        })
        .onConflictDoUpdate({
          target: matchingConfigs.id,
          set: {
            streetThreshold: aggregate.streetThreshold,
            houseNumberThreshold: aggregate.houseNumberThreshold,
            postalCodeThreshold: aggregate.postalCodeThreshold,
            stateThreshold: aggregate.stateThreshold,
            addressNameThreshold: aggregate.addressNameThreshold,
            overallThreshold: aggregate.overallThreshold,
            updatedAt: aggregate.updatedAt,
          },
        })
        .returning();

      if (!row) throw new Error(`MatchingConfig persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: MatchingConfig, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client
        .delete(matchingConfigs)
        .where(eq(matchingConfigs.id, aggregate.id))
        .returning();
      return rows.length > 0;
    },

    async findById(id: MatchingConfigId): Promise<MatchingConfig | null> {
      const [row] = await db
        .select()
        .from(matchingConfigs)
        .where(eq(matchingConfigs.id, id))
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async resolve(
      clientId: ClientId | null,
      partitionId: PartitionId | null,
    ): Promise<MatchingConfig> {
      // Precedence: (client, partition) → (client, NULL) → (NULL, NULL).
      // We ORDER BY a synthetic specificity column so the most-specific
      // matching row sorts first, then take LIMIT 1.
      const specificity = sql<number>`(
        CASE WHEN ${matchingConfigs.partitionId} IS NOT NULL THEN 2
             WHEN ${matchingConfigs.clientId} IS NOT NULL THEN 1
             ELSE 0
        END
      )`;

      const clientPredicate =
        clientId == null
          ? isNull(matchingConfigs.clientId)
          : sql`(${matchingConfigs.clientId} = ${clientId} OR ${matchingConfigs.clientId} IS NULL)`;

      const partitionPredicate =
        partitionId == null
          ? isNull(matchingConfigs.partitionId)
          : sql`(${matchingConfigs.partitionId} = ${partitionId} OR ${matchingConfigs.partitionId} IS NULL)`;

      const [row] = await db
        .select()
        .from(matchingConfigs)
        .where(and(clientPredicate, partitionPredicate))
        .orderBy(sql`${specificity} DESC`)
        .limit(1);

      if (row) return toDomain(row);

      // Defensive fallback — should never hit since 'mcf_GLOBAL_DEFAULT' is
      // seeded by the migration. If the seed is absent (e.g. fresh DB
      // missing the seed migration), synthesize the defaults rather than
      // returning null.
      const now = new Date();
      return {
        id: asMatchingConfigId('mcf_GLOBAL_DEFAULT'),
        clientId: null,
        partitionId: null,
        ...MATCHING_CONFIG_DEFAULTS,
        createdAt: now,
        updatedAt: now,
      };
    },
  };
}
