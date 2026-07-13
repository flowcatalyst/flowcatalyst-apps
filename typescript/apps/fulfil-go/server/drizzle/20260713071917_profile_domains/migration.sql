DROP INDEX "uq_store_profiles_client_code";--> statement-breakpoint
ALTER TABLE "store_profiles" ADD COLUMN "domain" text DEFAULT 'pick' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "pick_profile_code" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "pick_settings_overrides" jsonb;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "transport_profile_code" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "transport_settings_overrides" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_store_profiles_client_domain_code" ON "store_profiles" ("client_id","domain","code");--> statement-breakpoint
-- Split the single profile dimension into PICK + TRANSPORT domains
-- (Andrew, 2026-07-13). Existing rows become the PICK profile (transport
-- keys stripped); a sibling TRANSPORT row is created per profile carrying
-- ONLY the transport keys, so existing assignments keep working under the
-- same codes in both dimensions.
INSERT INTO "store_profiles" ("id", "client_id", "domain", "code", "name", "settings", "created_at", "updated_at")
SELECT 'spr_' || upper(substr(md5("id" || 'transport'), 1, 13)), "client_id", 'transport', "code", "name",
       jsonb_strip_nulls(jsonb_build_object(
         'executionSystems', "settings"->'executionSystems',
         'defaultExecutionSystem', "settings"->'defaultExecutionSystem')),
       "created_at", "updated_at"
FROM "store_profiles" WHERE "domain" = 'pick';--> statement-breakpoint
UPDATE "store_profiles" SET "settings" = "settings" - 'executionSystems' - 'defaultExecutionSystem' WHERE "domain" = 'pick';--> statement-breakpoint
-- Stores: both dimensions start on the previously assigned profile code;
-- overrides split by key family; geo extracted from the captured record.
UPDATE "stores" SET
  "pick_profile_code" = "profile_code",
  "transport_profile_code" = "profile_code",
  "pick_settings_overrides" = NULLIF("settings_overrides" - 'executionSystems' - 'defaultExecutionSystem', '{}'::jsonb),
  "transport_settings_overrides" = NULLIF(jsonb_strip_nulls(jsonb_build_object(
    'executionSystems', "settings_overrides"->'executionSystems',
    'defaultExecutionSystem', "settings_overrides"->'defaultExecutionSystem')), '{}'::jsonb),
  "lat" = ("data"->'geo'->>'lat')::double precision,
  "lng" = ("data"->'geo'->>'lng')::double precision;
