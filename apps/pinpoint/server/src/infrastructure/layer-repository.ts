import { and, asc, count, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
import { asClientId, type ClientId } from '../domain/tenancy/ids.js';
import { asLayerId, type LayerId } from '../domain/layers/ids.js';
import type { Layer, LayerKind, LayerStatus } from '../domain/layers/layer.js';
import type {
  LayerRepository,
  ListLayersQuery,
  ListLayersResult,
} from '../domain/layers/layer.repository.js';
import { layers, type LayerRow } from './schema/layers.js';
import { layerPartitions } from './schema/layer-partitions.js';

function toDomain(row: LayerRow): Layer {
  return {
    id: asLayerId(row.id),
    clientId: asClientId(row.clientId),
    code: row.code,
    name: row.name,
    description: row.description,
    layerType: row.layerType as LayerKind,
    centerLat: row.centerLat,
    centerLon: row.centerLon,
    radiusMeters: row.radiusMeters,
    polygonGeojson: row.polygonGeojson,
    status: row.status as LayerStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleLayerRepository(db: PostgresJsDatabase): LayerRepository {
  return {
    async persist(aggregate: Layer, tx?: TransactionContext): Promise<Layer> {
      const client = resolveDb(db, tx);
      const [row] = await client
        .insert(layers)
        .values({
          id: aggregate.id,
          clientId: aggregate.clientId,
          code: aggregate.code,
          name: aggregate.name,
          description: aggregate.description,
          layerType: aggregate.layerType,
          centerLat: aggregate.centerLat,
          centerLon: aggregate.centerLon,
          radiusMeters: aggregate.radiusMeters,
          polygonGeojson: aggregate.polygonGeojson,
          status: aggregate.status,
          createdAt: aggregate.createdAt,
          updatedAt: aggregate.updatedAt,
        })
        .onConflictDoUpdate({
          target: layers.id,
          set: {
            code: aggregate.code,
            name: aggregate.name,
            description: aggregate.description,
            centerLat: aggregate.centerLat,
            centerLon: aggregate.centerLon,
            radiusMeters: aggregate.radiusMeters,
            polygonGeojson: aggregate.polygonGeojson,
            status: aggregate.status,
            updatedAt: aggregate.updatedAt,
          },
        })
        .returning();

      if (!row) throw new Error(`Layer persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: Layer, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client.delete(layers).where(eq(layers.id, aggregate.id)).returning();
      return rows.length > 0;
    },

    async findById(id: LayerId): Promise<Layer | null> {
      const [row] = await db.select().from(layers).where(eq(layers.id, id)).limit(1);
      return row ? toDomain(row) : null;
    },

    async findByClientAndCode(clientId: ClientId, code: string): Promise<Layer | null> {
      const [row] = await db
        .select()
        .from(layers)
        .where(and(eq(layers.clientId, clientId), eq(layers.code, code)))
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async listByClient(query: ListLayersQuery): Promise<ListLayersResult> {
      const where = eq(layers.clientId, query.clientId);
      const [rows, totalRow] = await Promise.all([
        db
          .select()
          .from(layers)
          .where(where)
          .orderBy(asc(layers.createdAt))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ value: count() }).from(layers).where(where),
      ]);
      return {
        layers: rows.map(toDomain),
        total: Number(totalRow[0]?.value ?? 0),
      };
    },

    async findPartitionIds(layerId: LayerId): Promise<readonly string[]> {
      const rows = await db
        .select({ partitionId: layerPartitions.partitionId })
        .from(layerPartitions)
        .where(eq(layerPartitions.layerId, layerId));
      return rows.map((r) => r.partitionId);
    },

    async setPartitionIds(
      layerId: LayerId,
      partitionIds: readonly string[],
    ): Promise<void> {
      // Replace-all atomically — delete existing assignments then insert
      // the new set. No aggregate / event involved (matches Rust's
      // `set_layer_partitions`). Wrap in a tx to avoid leaving a layer
      // with no rows visible mid-write.
      await db.transaction(async (tx) => {
        await tx
          .delete(layerPartitions)
          .where(eq(layerPartitions.layerId, layerId));
        if (partitionIds.length > 0) {
          await tx
            .insert(layerPartitions)
            .values(partitionIds.map((partitionId) => ({ layerId, partitionId })))
            .onConflictDoNothing();
        }
      });
    },
  };
}
