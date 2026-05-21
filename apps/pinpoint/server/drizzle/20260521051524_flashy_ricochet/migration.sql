CREATE TABLE "master_locations" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"partition_id" text,
	"normalized_house_number" text,
	"normalized_road" text,
	"normalized_suburb" text,
	"normalized_city" text NOT NULL,
	"normalized_state" text,
	"normalized_postal_code" text,
	"normalized_country" text NOT NULL,
	"address_hash" text NOT NULL,
	"normalized_address_line" text,
	"latitude" double precision,
	"longitude" double precision,
	"point" geometry(Geometry,4326),
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processing_log" (
	"id" text PRIMARY KEY,
	"master_location_id" text NOT NULL,
	"step" text NOT NULL,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_master_locations_client" ON "master_locations" ("client_id");--> statement-breakpoint
CREATE INDEX "idx_master_locations_hash" ON "master_locations" ("address_hash");--> statement-breakpoint
CREATE INDEX "idx_master_locations_status" ON "master_locations" ("status");--> statement-breakpoint
CREATE INDEX "idx_master_locations_point" ON "master_locations" USING gist ("point");--> statement-breakpoint
CREATE INDEX "idx_master_locations_address_trgm" ON "master_locations" USING gist ("normalized_address_line" gist_trgm_ops) WHERE "normalized_address_line" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_processing_log_master" ON "processing_log" ("master_location_id");--> statement-breakpoint
CREATE INDEX "idx_processing_log_step" ON "processing_log" ("master_location_id","step");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_master_location_id_master_locations_id_fkey" FOREIGN KEY ("master_location_id") REFERENCES "master_locations"("id");--> statement-breakpoint
ALTER TABLE "master_locations" ADD CONSTRAINT "master_locations_client_id_clients_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id");--> statement-breakpoint
ALTER TABLE "master_locations" ADD CONSTRAINT "master_locations_partition_id_partitions_id_fkey" FOREIGN KEY ("partition_id") REFERENCES "partitions"("id");--> statement-breakpoint
ALTER TABLE "processing_log" ADD CONSTRAINT "processing_log_master_location_id_master_locations_id_fkey" FOREIGN KEY ("master_location_id") REFERENCES "master_locations"("id") ON DELETE CASCADE;