ALTER TABLE "locations" DROP CONSTRAINT "locations_master_location_id_master_locations_id_fkey";--> statement-breakpoint
DROP INDEX "idx_locations_master";--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "source_master_location_id" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "point" geometry(Geometry,4326);--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "geocode_source" varchar(20);--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "geocode_confidence" double precision;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "geocode_road_matched" boolean;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "geocode_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "geocoded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "capture_master_location_id" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "capture_distance_m" double precision;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "capture_review" varchar(20);--> statement-breakpoint
ALTER TABLE "master_locations" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "master_locations" ADD COLUMN "origin" varchar(20) DEFAULT 'MIGRATED' NOT NULL;--> statement-breakpoint
ALTER TABLE "master_locations" ADD COLUMN "origin_location_id" text;--> statement-breakpoint
ALTER TABLE "master_locations" ADD COLUMN "capture_accuracy_m" double precision;--> statement-breakpoint
ALTER TABLE "master_locations" ADD COLUMN "captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matching_configs" ADD COLUMN "auto_approve_threshold" double precision DEFAULT 0.9 NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_log" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "master_locations" ALTER COLUMN "status" SET DEFAULT 'DRAFT';--> statement-breakpoint
ALTER TABLE "processing_log" ALTER COLUMN "master_location_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_locations_source_master" ON "locations" ("source_master_location_id");--> statement-breakpoint
CREATE INDEX "idx_locations_point" ON "locations" USING gist ("point");--> statement-breakpoint
CREATE INDEX "idx_locations_geocode_expires" ON "locations" ("geocode_expires_at") WHERE "geocode_expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_locations_match_address_trgm" ON "locations" USING gist (lower("match_address") gist_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_processing_log_location" ON "processing_log" ("location_id");--> statement-breakpoint
ALTER TABLE "processing_log" ADD CONSTRAINT "processing_log_location_id_locations_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE;--> statement-breakpoint
-- ── Data: locations take over their master's geocode; masters become reference data ──
-- Google-sourced masters (never released, but possible in dev) can't stay
-- masters: their locations keep the coordinates as a cached Google geocode.
UPDATE "locations" l SET
  "latitude" = m."latitude", "longitude" = m."longitude",
  "point" = CASE WHEN m."latitude" IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint(m."longitude", m."latitude"), 4326) END,
  "geocode_source" = 'GOOGLE_MAPS', "geocode_expires_at" = m."geocode_expires_at",
  "geocoded_at" = m."updated_at",
  "normalized_house_number" = m."normalized_house_number", "normalized_road" = m."normalized_road",
  "normalized_suburb" = m."normalized_suburb", "normalized_city" = m."normalized_city",
  "normalized_state" = m."normalized_state", "normalized_postal_code" = m."normalized_postal_code",
  "normalized_country" = m."normalized_country",
  "status" = CASE WHEN m."status" = 'VALIDATED' THEN 'VALIDATED' ELSE 'GEOCODED' END,
  "validated_at" = CASE WHEN m."status" = 'VALIDATED' THEN m."validated_at" END
FROM "master_locations" m
WHERE l."master_location_id" = m."id" AND m."geocode_source" = 'GOOGLE_MAPS';
--> statement-breakpoint
-- VALIDATED masters: their locations copy the data and keep a reference.
UPDATE "locations" l SET
  "source_master_location_id" = m."id",
  "latitude" = m."latitude", "longitude" = m."longitude",
  "point" = CASE WHEN m."latitude" IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint(m."longitude", m."latitude"), 4326) END,
  "geocode_source" = 'MASTER_LOCATIONS',
  "geocode_confidence" = coalesce(l."match_confidence", 1),
  "geocoded_at" = m."updated_at",
  "validated_at" = coalesce(m."validated_at", m."updated_at"),
  "normalized_house_number" = m."normalized_house_number", "normalized_road" = m."normalized_road",
  "normalized_suburb" = m."normalized_suburb", "normalized_city" = m."normalized_city",
  "normalized_state" = m."normalized_state", "normalized_postal_code" = m."normalized_postal_code",
  "normalized_country" = m."normalized_country",
  "status" = 'VALIDATED'
FROM "master_locations" m
WHERE l."master_location_id" = m."id" AND m."status" = 'VALIDATED'
  AND m."geocode_source" IS DISTINCT FROM 'GOOGLE_MAPS';
--> statement-breakpoint
-- GEOCODED masters: their locations take the coordinates and await approval.
UPDATE "locations" l SET
  "latitude" = m."latitude", "longitude" = m."longitude",
  "point" = CASE WHEN m."latitude" IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint(m."longitude", m."latitude"), 4326) END,
  "geocode_source" = coalesce(m."geocode_source", 'PHOTON'),
  "geocoded_at" = m."updated_at",
  "normalized_house_number" = m."normalized_house_number", "normalized_road" = m."normalized_road",
  "normalized_suburb" = m."normalized_suburb", "normalized_city" = m."normalized_city",
  "normalized_state" = m."normalized_state", "normalized_postal_code" = m."normalized_postal_code",
  "normalized_country" = m."normalized_country",
  "status" = 'GEOCODED'
FROM "master_locations" m
WHERE l."master_location_id" = m."id" AND m."status" = 'GEOCODED'
  AND m."geocode_source" IS DISTINCT FROM 'GOOGLE_MAPS';
--> statement-breakpoint
-- PENDING masters: their locations stay PENDING (nothing resolved yet).
UPDATE "locations" l SET "status" = 'PENDING'
FROM "master_locations" m
WHERE l."master_location_id" = m."id" AND m."status" = 'PENDING';
--> statement-breakpoint
-- REJECTED masters: an operator said the place isn't real — so are its locations.
UPDATE "locations" l SET "status" = 'REJECTED'
FROM "master_locations" m
WHERE l."master_location_id" = m."id" AND m."status" = 'REJECTED';
--> statement-breakpoint
-- The trail of masters that are going away moves to their locations.
INSERT INTO "processing_log" ("id", "master_location_id", "location_id", "step", "data", "created_at")
SELECT p."id" || '_' || l."id", NULL, l."id", p."step", p."data", p."created_at"
FROM "processing_log" p
JOIN "master_locations" m ON m."id" = p."master_location_id"
JOIN "locations" l ON l."master_location_id" = m."id"
WHERE m."status" IN ('PENDING', 'GEOCODED') OR m."geocode_source" = 'GOOGLE_MAPS';
--> statement-breakpoint
-- Remaining masters: reference data. Name from their first location; source
-- OPERATOR when an operator confirmed the geocode, else PHOTON.
UPDATE "master_locations" m SET
  "origin" = 'MIGRATED',
  "name" = (SELECT l."name" FROM "locations" l WHERE l."master_location_id" = m."id"
            AND l."name" IS NOT NULL ORDER BY l."created_at" LIMIT 1),
  "geocode_source" = CASE
    WHEN m."latitude" IS NULL THEN NULL
    WHEN m."geocode_source" IS NOT NULL THEN m."geocode_source"
    WHEN EXISTS (SELECT 1 FROM "processing_log" p WHERE p."master_location_id" = m."id"
                 AND p."step" = 'confirm-geocode') THEN 'OPERATOR'
    ELSE 'PHOTON' END
WHERE m."status" IN ('VALIDATED', 'REJECTED') AND m."geocode_source" IS DISTINCT FROM 'GOOGLE_MAPS';
--> statement-breakpoint
-- Masters still in the old geocode-and-confirm pipeline, or holding Google
-- coordinates, are deleted: their locations now carry everything (above).
UPDATE "locations" SET "master_location_id" = NULL
WHERE "master_location_id" IN (SELECT "id" FROM "master_locations"
  WHERE "status" IN ('PENDING', 'GEOCODED') OR "geocode_source" = 'GOOGLE_MAPS');
--> statement-breakpoint
DELETE FROM "master_locations"
WHERE "status" IN ('PENDING', 'GEOCODED') OR "geocode_source" = 'GOOGLE_MAPS';
