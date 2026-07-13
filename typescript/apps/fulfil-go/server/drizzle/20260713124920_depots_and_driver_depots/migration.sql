CREATE TABLE "depot_stores" (
	"client_id" text NOT NULL,
	"depot_ref" text NOT NULL,
	"store_ref" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "depots" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"depot_ref" text NOT NULL,
	"name" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_users" RENAME COLUMN "store_ref" TO "depot_ref";--> statement-breakpoint
ALTER TABLE "driver_users" ADD COLUMN "default_vehicle_class" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_depot_stores_link" ON "depot_stores" ("client_id","depot_ref","store_ref");--> statement-breakpoint
CREATE INDEX "idx_depot_stores_store" ON "depot_stores" ("client_id","store_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_depots_client_ref" ON "depots" ("client_id","depot_ref");