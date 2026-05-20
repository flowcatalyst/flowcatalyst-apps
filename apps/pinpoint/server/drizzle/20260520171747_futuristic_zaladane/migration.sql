CREATE TABLE "audit_logs" (
	"id" varchar(13) PRIMARY KEY,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" varchar(100) NOT NULL,
	"operation" varchar(200) NOT NULL,
	"operation_json" jsonb,
	"principal_id" varchar(100) NOT NULL,
	"performed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"iso_a2" text NOT NULL,
	"iso_a3" text NOT NULL,
	"geometry" geometry(Geometry,4326)
);
--> statement-breakpoint
CREATE TABLE "layer_features" (
	"id" text PRIMARY KEY,
	"layer_id" text NOT NULL,
	"label" text NOT NULL,
	"center_lat" double precision,
	"center_lon" double precision,
	"radius_meters" double precision,
	"polygon_geojson" text,
	"boundary" geometry(Geometry,4326),
	"property_values" jsonb DEFAULT '{}' NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layer_partitions" (
	"layer_id" text,
	"partition_id" text,
	CONSTRAINT "layer_partitions_pkey" PRIMARY KEY("layer_id","partition_id")
);
--> statement-breakpoint
CREATE TABLE "layers" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"layer_type" text NOT NULL,
	"center_lat" double precision,
	"center_lon" double precision,
	"radius_meters" double precision,
	"polygon_geojson" text,
	"boundary" geometry(Geometry,4326),
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_attributes" (
	"id" text PRIMARY KEY,
	"location_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_feature_associations" (
	"location_id" text,
	"layer_feature_id" text,
	"layer_id" text NOT NULL,
	"distance_meters" double precision,
	"associated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_feature_associations_pkey" PRIMARY KEY("location_id","layer_feature_id")
);
--> statement-breakpoint
CREATE TABLE "location_layer_associations" (
	"location_id" text,
	"layer_id" text,
	"associated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_layer_associations_pkey" PRIMARY KEY("location_id","layer_id")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"partition_id" text,
	"master_location_id" text,
	"external_id" text,
	"name" text,
	"raw_address_line1" text NOT NULL,
	"raw_address_line2" text,
	"raw_suburb" text,
	"raw_city" text NOT NULL,
	"raw_state" text,
	"raw_postal_code" text,
	"raw_country" text NOT NULL,
	"normalized_house_number" text,
	"normalized_road" text,
	"normalized_suburb" text,
	"normalized_city" text,
	"normalized_state" text,
	"normalized_postal_code" text,
	"normalized_country" text,
	"address_hash" text,
	"match_confidence" double precision,
	"match_method" text,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matching_configs" (
	"id" text PRIMARY KEY,
	"client_id" text,
	"partition_id" text,
	"street_threshold" double precision DEFAULT 0.85 NOT NULL,
	"house_number_threshold" double precision DEFAULT 1 NOT NULL,
	"postal_code_threshold" double precision DEFAULT 0.95 NOT NULL,
	"state_threshold" double precision DEFAULT 0.9 NOT NULL,
	"address_name_threshold" double precision DEFAULT 0.8 NOT NULL,
	"overall_threshold" double precision DEFAULT 0.85 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matching_configs_client_partition_uq" UNIQUE NULLS NOT DISTINCT("client_id","partition_id")
);
--> statement-breakpoint
CREATE TABLE "partitions" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "principal_partitions" (
	"principal_id" text,
	"partition_id" text,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principal_partitions_pkey" PRIMARY KEY("principal_id","partition_id")
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" text PRIMARY KEY,
	"principal_type" varchar(20) NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" text PRIMARY KEY,
	"property_set_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_sets" (
	"id" text PRIMARY KEY,
	"layer_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_clients_code" ON "clients" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_countries_iso_a3" ON "countries" ("iso_a3") WHERE "iso_a3" <> '-99';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_countries_iso_a2" ON "countries" ("iso_a2") WHERE "iso_a2" <> '-99';--> statement-breakpoint
CREATE INDEX "idx_countries_geometry" ON "countries" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "idx_countries_name" ON "countries" ("name");--> statement-breakpoint
CREATE INDEX "idx_layer_features_layer" ON "layer_features" ("layer_id");--> statement-breakpoint
CREATE INDEX "idx_layer_features_status" ON "layer_features" ("status");--> statement-breakpoint
CREATE INDEX "idx_layer_features_boundary" ON "layer_features" USING gist ("boundary");--> statement-breakpoint
CREATE INDEX "idx_layer_partitions_layer" ON "layer_partitions" ("layer_id");--> statement-breakpoint
CREATE INDEX "idx_layer_partitions_partition" ON "layer_partitions" ("partition_id");--> statement-breakpoint
CREATE INDEX "idx_layers_client" ON "layers" ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_layers_client_code" ON "layers" ("client_id","code");--> statement-breakpoint
CREATE INDEX "idx_layers_boundary" ON "layers" USING gist ("boundary");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_location_attrs_location_key" ON "location_attributes" ("location_id","key");--> statement-breakpoint
CREATE INDEX "idx_location_attrs_location" ON "location_attributes" ("location_id");--> statement-breakpoint
CREATE INDEX "idx_lfa_location" ON "location_feature_associations" ("location_id");--> statement-breakpoint
CREATE INDEX "idx_lfa_feature" ON "location_feature_associations" ("layer_feature_id");--> statement-breakpoint
CREATE INDEX "idx_lfa_layer" ON "location_feature_associations" ("layer_id");--> statement-breakpoint
CREATE INDEX "idx_locations_client" ON "locations" ("client_id");--> statement-breakpoint
CREATE INDEX "idx_locations_master" ON "locations" ("master_location_id");--> statement-breakpoint
CREATE INDEX "idx_locations_hash" ON "locations" ("address_hash");--> statement-breakpoint
CREATE INDEX "idx_locations_status" ON "locations" ("status");--> statement-breakpoint
CREATE INDEX "idx_locations_address_hash" ON "locations" ("client_id","partition_id","address_hash") WHERE "address_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_locations_external_id" ON "locations" ("client_id","partition_id","external_id") WHERE "external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_partitions_client_code" ON "partitions" ("client_id","code");--> statement-breakpoint
CREATE INDEX "idx_principal_partitions_principal" ON "principal_partitions" ("principal_id");--> statement-breakpoint
CREATE INDEX "idx_principal_partitions_partition" ON "principal_partitions" ("partition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_properties_set_key" ON "properties" ("property_set_id","key");--> statement-breakpoint
CREATE INDEX "idx_properties_set" ON "properties" ("property_set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_property_sets_layer_name" ON "property_sets" ("layer_id","name");--> statement-breakpoint
ALTER TABLE "layer_features" ADD CONSTRAINT "layer_features_layer_id_layers_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "layers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "layer_partitions" ADD CONSTRAINT "layer_partitions_layer_id_layers_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "layers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "layer_partitions" ADD CONSTRAINT "layer_partitions_partition_id_partitions_id_fkey" FOREIGN KEY ("partition_id") REFERENCES "partitions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "layers" ADD CONSTRAINT "layers_client_id_clients_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id");--> statement-breakpoint
ALTER TABLE "location_attributes" ADD CONSTRAINT "location_attributes_location_id_locations_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "location_feature_associations" ADD CONSTRAINT "location_feature_associations_location_id_locations_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "location_feature_associations" ADD CONSTRAINT "location_feature_associations_oIulXloDa71Y_fkey" FOREIGN KEY ("layer_feature_id") REFERENCES "layer_features"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "location_feature_associations" ADD CONSTRAINT "location_feature_associations_layer_id_layers_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "layers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "location_layer_associations" ADD CONSTRAINT "location_layer_associations_location_id_locations_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "location_layer_associations" ADD CONSTRAINT "location_layer_associations_layer_id_layers_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "layers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_client_id_clients_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_partition_id_partitions_id_fkey" FOREIGN KEY ("partition_id") REFERENCES "partitions"("id");--> statement-breakpoint
ALTER TABLE "matching_configs" ADD CONSTRAINT "matching_configs_client_id_clients_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id");--> statement-breakpoint
ALTER TABLE "matching_configs" ADD CONSTRAINT "matching_configs_partition_id_partitions_id_fkey" FOREIGN KEY ("partition_id") REFERENCES "partitions"("id");--> statement-breakpoint
ALTER TABLE "partitions" ADD CONSTRAINT "partitions_client_id_clients_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id");--> statement-breakpoint
ALTER TABLE "principal_partitions" ADD CONSTRAINT "principal_partitions_principal_id_principals_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "principals"("id");--> statement-breakpoint
ALTER TABLE "principal_partitions" ADD CONSTRAINT "principal_partitions_partition_id_partitions_id_fkey" FOREIGN KEY ("partition_id") REFERENCES "partitions"("id");--> statement-breakpoint
ALTER TABLE "principal_partitions" ADD CONSTRAINT "principal_partitions_granted_by_principals_id_fkey" FOREIGN KEY ("granted_by") REFERENCES "principals"("id");--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_property_set_id_property_sets_id_fkey" FOREIGN KEY ("property_set_id") REFERENCES "property_sets"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "property_sets" ADD CONSTRAINT "property_sets_layer_id_layers_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "layers"("id") ON DELETE CASCADE;