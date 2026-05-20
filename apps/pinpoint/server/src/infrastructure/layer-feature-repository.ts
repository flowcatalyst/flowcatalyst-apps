import { asc, count, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { resolveDb, type TransactionContext } from '@flowcatalyst-apps/app-framework';
import {
  asLayerFeatureId,
  asLayerId,
  type LayerFeatureId,
} from '../domain/layers/ids.js';
import type {
  LayerFeature,
  LayerFeatureProperties,
  LayerFeatureStatus,
} from '../domain/layers/layer-feature.js';
import type {
  LayerFeatureRepository,
  ListLayerFeaturesQuery,
  ListLayerFeaturesResult,
} from '../domain/layers/layer-feature.repository.js';
import { layerFeatures, type LayerFeatureRow } from './schema/layer-features.js';

function toDomain(row: LayerFeatureRow): LayerFeature {
  return {
    id: asLayerFeatureId(row.id),
    layerId: asLayerId(row.layerId),
    label: row.label,
    centerLat: row.centerLat,
    centerLon: row.centerLon,
    radiusMeters: row.radiusMeters,
    polygonGeojson: row.polygonGeojson,
    propertyValues: (row.propertyValues ?? {}) as LayerFeatureProperties,
    status: row.status as LayerFeatureStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleLayerFeatureRepository(
  db: PostgresJsDatabase,
): LayerFeatureRepository {
  return {
    async persist(aggregate: LayerFeature, tx?: TransactionContext): Promise<LayerFeature> {
      const client = resolveDb(db, tx);
      const [row] = await client
        .insert(layerFeatures)
        .values({
          id: aggregate.id,
          layerId: aggregate.layerId,
          label: aggregate.label,
          centerLat: aggregate.centerLat,
          centerLon: aggregate.centerLon,
          radiusMeters: aggregate.radiusMeters,
          polygonGeojson: aggregate.polygonGeojson,
          propertyValues: aggregate.propertyValues,
          status: aggregate.status,
          createdAt: aggregate.createdAt,
          updatedAt: aggregate.updatedAt,
        })
        .onConflictDoUpdate({
          target: layerFeatures.id,
          set: {
            label: aggregate.label,
            centerLat: aggregate.centerLat,
            centerLon: aggregate.centerLon,
            radiusMeters: aggregate.radiusMeters,
            polygonGeojson: aggregate.polygonGeojson,
            propertyValues: aggregate.propertyValues,
            status: aggregate.status,
            updatedAt: aggregate.updatedAt,
          },
        })
        .returning();

      if (!row) throw new Error(`LayerFeature persist returned no row for id=${aggregate.id}`);
      return toDomain(row);
    },

    async delete(aggregate: LayerFeature, tx?: TransactionContext): Promise<boolean> {
      const client = resolveDb(db, tx);
      const rows = await client
        .delete(layerFeatures)
        .where(eq(layerFeatures.id, aggregate.id))
        .returning();
      return rows.length > 0;
    },

    async findById(id: LayerFeatureId): Promise<LayerFeature | null> {
      const [row] = await db
        .select()
        .from(layerFeatures)
        .where(eq(layerFeatures.id, id))
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async listByLayer(query: ListLayerFeaturesQuery): Promise<ListLayerFeaturesResult> {
      const where = eq(layerFeatures.layerId, query.layerId);
      const [rows, totalRow] = await Promise.all([
        db
          .select()
          .from(layerFeatures)
          .where(where)
          .orderBy(asc(layerFeatures.createdAt))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ value: count() }).from(layerFeatures).where(where),
      ]);
      return {
        features: rows.map(toDomain),
        total: Number(totalRow[0]?.value ?? 0),
      };
    },
  };
}
