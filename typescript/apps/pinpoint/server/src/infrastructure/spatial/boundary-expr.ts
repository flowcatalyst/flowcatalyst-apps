import { sql, type SQL } from 'drizzle-orm';

/**
 * PostGIS geometry for a layer / layer-feature `boundary` column, derived from
 * the scalar shape the API round-trips (port of the Rust INSERT in
 * `pinpoint-domain/src/entities/layer_feature.rs` and migration 011):
 *
 *   RADIUS  (center + radius)  → ST_Buffer(point::geography, metres)::geometry
 *   POLYGON (polygonGeojson)   → ST_SetSRID(ST_GeomFromGeoJSON(json), 4326)
 *   POINT   (center only)      → ST_SetSRID(ST_MakePoint(lon, lat), 4326)
 *   nothing                    → NULL
 *
 * Must be used by every repository write of those tables — `spatialLookup`,
 * `findFeaturesContainingPoint` and the GIST indexes all read `boundary`.
 */
export function boundaryGeometryExpr(shape: {
  readonly centerLat: number | null;
  readonly centerLon: number | null;
  readonly radiusMeters: number | null;
  readonly polygonGeojson: string | null;
}): SQL | null {
  const { centerLat, centerLon, radiusMeters, polygonGeojson } = shape;
  if (centerLat !== null && centerLon !== null && radiusMeters !== null) {
    return sql`ST_Buffer(ST_SetSRID(ST_MakePoint(${centerLon}::double precision, ${centerLat}::double precision), 4326)::geography, ${radiusMeters}::double precision)::geometry`;
  }
  if (polygonGeojson !== null) {
    return sql`ST_SetSRID(ST_GeomFromGeoJSON(${polygonGeojson}), 4326)`;
  }
  if (centerLat !== null && centerLon !== null) {
    return sql`ST_SetSRID(ST_MakePoint(${centerLon}::double precision, ${centerLat}::double precision), 4326)`;
  }
  return null;
}
