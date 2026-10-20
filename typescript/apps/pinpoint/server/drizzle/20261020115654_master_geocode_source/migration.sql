ALTER TABLE "master_locations" ADD COLUMN "geocode_source" varchar(20);--> statement-breakpoint
ALTER TABLE "master_locations" ADD COLUMN "geocode_expires_at" timestamp with time zone;