import { asc, count, eq, sql } from 'drizzle-orm';
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
  FeatureAssociation,
  LayerFeatureRepository,
  ListLayerFeaturesQuery,
  ListLayerFeaturesResult,
  LocationFeatureAssociationInput,
  SpatialLookupHit,
  SpatialLookupQuery,
} from '../domain/layers/layer-feature.repository.js';
import { layerFeatures, type LayerFeatureRow } from './schema/layer-features.js';
import { layers } from './schema/layers.js';
import { locationFeatureAssociations } from './schema/location-feature-associations.js';

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

    async spatialLookup(query: SpatialLookupQuery): Promise<readonly SpatialLookupHit[]> {
      // Two-half UNION ALL: containment matches for RADIUS/POLYGON layers,
      // nearest-per-layer for POINT layers. Mirrors the Rust pinpoint-infra
      // pg_layer_feature_repository.rs `spatial_lookup` query.
      //
      // We build both halves with the same predicate bag so Postgres can
      // re-use the GIST index on `boundary` for the containment branch.
      const queryPoint = sql`ST_SetSRID(ST_MakePoint(${query.longitude}, ${query.latitude}), 4326)`;

      const partitionFilter =
        query.partitionId == null
          ? sql`AND NOT EXISTS (SELECT 1 FROM layer_partitions lp WHERE lp.layer_id = l.id)`
          : sql`AND (
              NOT EXISTS (SELECT 1 FROM layer_partitions lp WHERE lp.layer_id = l.id)
              OR EXISTS (
                SELECT 1 FROM layer_partitions lp
                WHERE lp.layer_id = l.id AND lp.partition_id = ${query.partitionId}
              )
            )`;

      // postgres-js + drizzle parameterize sql`` template tags safely; for the
      // IN() list we use sql.join over the array.
      const codesInClause =
        query.layerCodes != null && query.layerCodes.length > 0
          ? sql`AND l.code IN (${sql.join(
              query.layerCodes.map((c) => sql`${c}`),
              sql`, `,
            )})`
          : sql``;

      const lookupSql = sql<{
        feature_id: string;
        layer_id: string;
        layer_code: string;
        layer_name: string;
        layer_type: string;
        label: string;
        property_values: unknown;
        center_lat: number | null;
        center_lon: number | null;
        radius_meters: number | null;
        boundary_wkt: string | null;
        distance_meters: number | null;
      }>`
        (
          SELECT lf.id AS feature_id, lf.layer_id, l.code AS layer_code,
                 l.name AS layer_name, l.layer_type, lf.label,
                 lf.property_values,
                 lf.center_lat, lf.center_lon, lf.radius_meters,
                 CASE WHEN l.layer_type = 'POLYGON' AND lf.boundary IS NOT NULL
                      THEN ST_AsText(lf.boundary)
                      ELSE NULL
                 END AS boundary_wkt,
                 NULL::double precision AS distance_meters
          FROM layer_features lf
          JOIN layers l ON l.id = lf.layer_id
          WHERE l.client_id = ${query.clientId}
            AND l.status = 'ACTIVE'
            AND lf.status = 'ACTIVE'
            AND l.layer_type IN ('RADIUS', 'POLYGON')
            AND lf.boundary IS NOT NULL
            AND ST_Intersects(lf.boundary, ${queryPoint})
            ${partitionFilter}
            ${codesInClause}
        )
        UNION ALL
        (
          SELECT DISTINCT ON (lf.layer_id)
                 lf.id AS feature_id, lf.layer_id, l.code AS layer_code,
                 l.name AS layer_name, l.layer_type, lf.label,
                 lf.property_values,
                 lf.center_lat, lf.center_lon, lf.radius_meters,
                 NULL::text AS boundary_wkt,
                 ST_Distance(lf.boundary::geography, ${queryPoint}::geography) AS distance_meters
          FROM layer_features lf
          JOIN layers l ON l.id = lf.layer_id
          WHERE l.client_id = ${query.clientId}
            AND l.status = 'ACTIVE'
            AND lf.status = 'ACTIVE'
            AND l.layer_type = 'POINT'
            AND lf.boundary IS NOT NULL
            ${partitionFilter}
            ${codesInClause}
          ORDER BY lf.layer_id, ST_Distance(lf.boundary::geography, ${queryPoint}::geography)
        )
        ORDER BY layer_name, label
      `;

      const rows = (await db.execute(lookupSql)) as unknown as ReadonlyArray<{
        feature_id: string;
        layer_id: string;
        layer_code: string;
        layer_name: string;
        layer_type: string;
        label: string;
        property_values: unknown;
        center_lat: number | null;
        center_lon: number | null;
        radius_meters: number | null;
        boundary_wkt: string | null;
        distance_meters: number | null;
      }>;

      return rows.map((r) => {
        const props =
          r.property_values && typeof r.property_values === 'object'
            ? (r.property_values as Record<string, unknown>)
            : {};
        const propertyValues: LayerFeatureProperties = Object.fromEntries(
          Object.entries(props).map(([k, v]) => [k, typeof v === 'string' ? v : String(v)]),
        );

        return {
          layerId: r.layer_id,
          layerCode: r.layer_code,
          layerName: r.layer_name,
          layerType: r.layer_type as 'RADIUS' | 'POLYGON' | 'POINT',
          featureId: r.feature_id,
          featureLabel: r.label,
          distanceMeters: r.distance_meters,
          propertyValues,
          centerLat: r.center_lat,
          centerLon: r.center_lon,
          radiusMeters: r.radius_meters,
          polygonPoints: r.boundary_wkt ? parsePolygonWkt(r.boundary_wkt) : null,
        };
      });
    },

    async replaceLocationFeatureAssociations(
      locationId: string,
      associations: readonly LocationFeatureAssociationInput[],
      tx?: TransactionContext,
    ): Promise<void> {
      const client = resolveDb(db, tx);
      await client
        .delete(locationFeatureAssociations)
        .where(eq(locationFeatureAssociations.locationId, locationId));

      if (associations.length === 0) return;
      await client
        .insert(locationFeatureAssociations)
        .values(
          associations.map((a) => ({
            locationId,
            layerFeatureId: a.featureId,
            layerId: a.layerId,
            distanceMeters: a.distanceMeters,
          })),
        )
        .onConflictDoNothing();
    },

    async findFeatureAssociations(
      locationId: string,
    ): Promise<readonly FeatureAssociation[]> {
      const rows = await db
        .select({
          layerFeatureId: locationFeatureAssociations.layerFeatureId,
          layerId: locationFeatureAssociations.layerId,
          distanceMeters: locationFeatureAssociations.distanceMeters,
          layerName: layers.name,
          featureLabel: layerFeatures.label,
        })
        .from(locationFeatureAssociations)
        .innerJoin(
          layerFeatures,
          eq(layerFeatures.id, locationFeatureAssociations.layerFeatureId),
        )
        .innerJoin(layers, eq(layers.id, locationFeatureAssociations.layerId))
        .where(eq(locationFeatureAssociations.locationId, locationId))
        .orderBy(asc(layers.name), asc(layerFeatures.label));
      return rows.map((r) => ({
        layerFeatureId: r.layerFeatureId,
        layerId: r.layerId,
        layerName: r.layerName,
        featureLabel: r.featureLabel,
        distanceMeters: r.distanceMeters,
      }));
    },
  };
}

/**
 * Parse a PostGIS WKT POLYGON literal into `lng,lat;lng,lat;…` form.
 * Mirrors the Rust `parse_polygon_wkt` helper so API consumers see the
 * same payload shape across both backends.
 */
function parsePolygonWkt(wkt: string): string | null {
  const start = wkt.indexOf('((');
  const end = wkt.lastIndexOf('))');
  if (start === -1 || end === -1) return null;
  const inner = wkt.slice(start + 2, end);
  const points = inner
    .split(',')
    .map((pair) => pair.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map((parts) => `${parts[0]},${parts[1]}`);
  return points.length === 0 ? null : points.join(';');
}
