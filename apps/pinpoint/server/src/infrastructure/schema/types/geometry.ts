/**
 * PostGIS GEOMETRY(Geometry, 4326) column type for Drizzle.
 *
 * Why a customType: Drizzle's built-in pg-core types don't include PostGIS
 * geometry. We need this for two reasons:
 *  1. drizzle-kit must emit the correct DDL — `geometry(Geometry, 4326)`,
 *     not `text` — when generating migrations for `layers.boundary`,
 *     `layer_features.boundary`, and `countries.geometry`.
 *  2. GIST indexes (`.using('gist', t.col)`) need a real geometry-typed
 *     column to compile against in pg.
 *
 * Why we don't fully wrap toDriver/fromDriver: PostGIS geometry writes are
 * always wrapped in functions (`ST_GeomFromText`, `ST_MakePoint`,
 * `ST_Buffer`, …) which a `customType` parameter binding cannot supply
 * — they're SQL expressions, not values. So pinpoint never .insert()s
 * raw geometry through Drizzle's value path; spatial writes use
 * `sql\`ST_*(${param}, 4326)\`` directly in the query.
 *
 * Reads similarly: production code always projects geometry via
 * `ST_AsText(col)` or `ST_AsGeoJSON(col)` rather than selecting the raw
 * EWKB hex. This type exists primarily so drizzle-kit's introspection
 * + generation gives us the right column shape.
 *
 * See `docs/spatial-queries.md` for the full pattern.
 */
import { customType } from 'drizzle-orm/pg-core';

/**
 * Stored as `geometry(Geometry, 4326)` in Postgres. Application-facing
 * value type is `string` (EWKB hex from postgres-js by default), but app
 * code should not select this column raw — see file header.
 *
 * `codec: 'text'` opts out of Drizzle's built-in `geometry` codec, which
 * is hard-coded to parse PostGIS rows as `[x, y]` POINT tuples via
 * `parseEWKB` and throws "Unsupported geometry type" for POLYGON /
 * MULTIPOLYGON / etc. Without this opt-out, every read against a table
 * holding a non-POINT boundary blows up — even when the consuming repo
 * never reads the boundary column itself, because Drizzle still runs
 * normalization across all selected rows. Treating the column as opaque
 * text bytes leaves the WKB hex string intact for read paths that
 * explicitly project it via `ST_AsText` / `ST_AsGeoJSON`.
 */
export const geometry = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(Geometry, 4326)';
  },
  codec: 'text',
});
