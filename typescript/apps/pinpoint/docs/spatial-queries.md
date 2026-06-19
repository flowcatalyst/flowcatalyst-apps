# Spatial queries in pinpoint

This is the pattern for working with PostGIS through Drizzle 1.0 in the
pinpoint server. Slice 5 introduced it, and every later spatial slice
(matching pipeline, geocoder rate-limited reads, master-location point
storage) layers on top of the same primitives. Read this once before
adding any new spatial column or query.

## TL;DR

| Concern                       | How we do it                                                        |
| ----------------------------- | ------------------------------------------------------------------- |
| Geometry column type          | `geometry()` custom type — emits `geometry(Geometry, 4326)` DDL     |
| GIST index on a geometry      | `index('…').using('gist', t.boundary)`                              |
| Inserts / updates of geometry | Raw `sql\`ST_GeomFromText(${wkt}, 4326)\`` — never the Drizzle bind |
| Spatial predicates            | Raw `sql\`ST_Intersects(…)\``/`ST_DWithin(…)`/`<->`                 |
| Reading geometry back         | Always wrap in `ST_AsText(col)` / `ST_AsGeoJSON(col)` — never raw   |
| Manual bootstrap (extension)  | `pnpm db:init` creates `postgis` + `pg_trgm` in dev / CI            |

## The customType

```ts
// infrastructure/schema/types/geometry.ts
export const geometry = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(Geometry, 4326)';
  },
  codec: 'text', // see "codec opt-out" gotcha below
});
```

Used in schemas like:

```ts
import { geometry } from './types/geometry.js';

export const layers = pgTable(
  'layers',
  {
    // …
    boundary: geometry('boundary'),
  },
  (t) => [index('idx_layers_boundary').using('gist', t.boundary)],
);
```

Why a customType (not `text` + manual cast in every query):

1. drizzle-kit emits the correct DDL (`geometry(Geometry, 4326)`), so
   `db:generate` produces a migration that creates a real PostGIS column
   — not a `TEXT` column the GIST index would refuse to attach to.
2. The schema reads as the intent ("this column holds a geometry"), which
   makes greps for spatial code easy.

What it does _not_ do:

- It does **not** wrap inserts in `ST_GeomFromText()`. PostGIS writes are
  SQL function calls, not bind values, so a `customType` parameter cannot
  supply them. Spatial inserts always use a raw `sql\`\`` fragment.
- It does **not** parse geometry on read. Selecting a `geometry` column
  directly returns the EWKB hex string. Production reads always project
  via `ST_AsText(col)` or `ST_AsGeoJSON(col)` to get usable output.

## Writing spatial values

Every spatial write goes through `sql\`\``. Two common shapes:

```ts
// From a (lat, lon) → POINT(lon, lat) in WGS84
import { sql } from 'drizzle-orm';

await db
  .update(masterLocations)
  .set({
    point: sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`,
  })
  .where(eq(masterLocations.id, id));

// From a GeoJSON string → polygon geometry
await db
  .update(layers)
  .set({
    boundary: sql`ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)`,
  })
  .where(eq(layers.id, id));
```

Order of `lon, lat` (not `lat, lon`) is non-negotiable — `ST_MakePoint`
takes `(x, y)` which in WGS84 is `(longitude, latitude)`. Backward
projects break silently and far from the bug site.

## Reading spatial values

If you only need a predicate (containment, distance, intersection),
**don't read the geometry column** — let Postgres compute and project
just the scalar result.

```ts
// Distance-only read (meters) — geography cast does the haversine math.
const [row] = await db.execute(sql`
  SELECT ST_Distance(boundary::geography, ${queryPoint}::geography) AS meters
  FROM layer_features WHERE id = ${id}
`);
```

When you need the geometry itself in app code, project as WKT or GeoJSON:

```ts
const rows = await db.execute(sql`
  SELECT id, ST_AsText(boundary) AS wkt, ST_AsGeoJSON(boundary) AS geojson
  FROM layers WHERE client_id = ${clientId}
`);
```

`ST_AsText` is cheap and human-readable; `ST_AsGeoJSON` is what the
front-end usually wants. We pick per-column based on consumer.

## Spatial predicates

Three patterns we use:

```ts
// Containment / intersection (uses GIST index)
sql`ST_Intersects(lf.boundary, ${queryPoint})`;

// Within N meters (uses GIST index when col is geography or has SRID)
sql`ST_DWithin(boundary::geography, ${queryPoint}::geography, ${meters})`;

// Nearest-neighbor ordering (KNN — uses GIST index with `<->` operator)
sql`boundary <-> ${queryPoint}`; // smaller = closer; use in ORDER BY
```

`spatial-lookup` in `infrastructure/layer-feature-repository.ts` combines
the first and third inside a UNION ALL: containment for RADIUS / POLYGON
layers, nearest-per-layer for POINT layers.

## Extension bootstrapping

`CREATE EXTENSION` cannot be emitted by drizzle-kit (and shouldn't be —
extensions are an operator concern, not a schema concern). The
`pnpm db:init` script creates `postgis` and `pg_trgm` in the local dev
database. For production / CI, the same script (or a hand-written
"0000_extensions.sql" migration) needs to run before any drizzle-kit
migration that creates a `geometry()` column.

If you see `ERROR: type "geometry" does not exist`, that's the symptom —
`db:init` hasn't run against this DB yet.

## Cumulative gotchas

- **Drizzle 1.0's built-in `geometry` codec only handles POINT.** It
  routes any column whose SQL type starts with the word `geometry`
  through `parseEWKB`, which throws `Unsupported geometry type` for
  POLYGON / MULTIPOLYGON / etc. Our customType passes `codec: 'text'`
  to opt out — without it, every read against a table holding a
  non-POINT boundary blows up, even from repos that don't read the
  boundary column directly (normalization runs across all selected
  rows). If you see "Unsupported geometry type" in a stack trace, the
  customType lost its `codec: 'text'`.
- **`uniqueIndex(...).nullsNotDistinct()` doesn't exist.** Use
  `unique(...).on(cols).nullsNotDistinct()` instead — the `nullsNotDistinct`
  method lives on `UniqueConstraintBuilder`, not `IndexBuilder` in Drizzle
  1.0 RC. Matching-configs needs `UNIQUE NULLS NOT DISTINCT (client_id,
partition_id)` so the global default row with both columns NULL is
  unique.
- **Polygon WKT parsing happens in the repo, not the route.** The
  `parsePolygonWkt` helper in `layer-feature-repository.ts` is a TS port
  of the Rust helper — keep them in sync if the wire format changes.
- **GIST + null boundary.** Most spatial queries should filter
  `WHERE boundary IS NOT NULL` before the predicate; the GIST index
  doesn't index nulls and an unfiltered query against a sparse column
  still works but does extra row visits.
