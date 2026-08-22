-- Backfill PostGIS geometries that the TypeScript port never wrote on persist
-- (fixed 2026-08-22: infrastructure/spatial/boundary-expr.ts). Mirrors the
-- Rust migration 011 so rows created through this API before the fix become
-- visible to spatial containment again. Idempotent — only NULL geometries.

UPDATE "layer_features"
SET "boundary" = ST_Buffer(
    ST_SetSRID(ST_MakePoint("center_lon", "center_lat"), 4326)::geography,
    "radius_meters"
)::geometry
WHERE "boundary" IS NULL
  AND "center_lat" IS NOT NULL
  AND "center_lon" IS NOT NULL
  AND "radius_meters" IS NOT NULL;--> statement-breakpoint

UPDATE "layer_features"
SET "boundary" = ST_SetSRID(ST_GeomFromGeoJSON("polygon_geojson"), 4326)
WHERE "boundary" IS NULL
  AND "polygon_geojson" IS NOT NULL;--> statement-breakpoint

UPDATE "layer_features"
SET "boundary" = ST_SetSRID(ST_MakePoint("center_lon", "center_lat"), 4326)
WHERE "boundary" IS NULL
  AND "center_lat" IS NOT NULL
  AND "center_lon" IS NOT NULL;--> statement-breakpoint

UPDATE "layers"
SET "boundary" = ST_Buffer(
    ST_SetSRID(ST_MakePoint("center_lon", "center_lat"), 4326)::geography,
    "radius_meters"
)::geometry
WHERE "boundary" IS NULL
  AND "center_lat" IS NOT NULL
  AND "center_lon" IS NOT NULL
  AND "radius_meters" IS NOT NULL;--> statement-breakpoint

UPDATE "layers"
SET "boundary" = ST_SetSRID(ST_GeomFromGeoJSON("polygon_geojson"), 4326)
WHERE "boundary" IS NULL
  AND "polygon_geojson" IS NOT NULL;--> statement-breakpoint

UPDATE "layers"
SET "boundary" = ST_SetSRID(ST_MakePoint("center_lon", "center_lat"), 4326)
WHERE "boundary" IS NULL
  AND "center_lat" IS NOT NULL
  AND "center_lon" IS NOT NULL;--> statement-breakpoint

-- master_locations.point is written by persist already; backfill defensively.
UPDATE "master_locations"
SET "point" = ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)
WHERE "point" IS NULL
  AND "latitude" IS NOT NULL
  AND "longitude" IS NOT NULL;
