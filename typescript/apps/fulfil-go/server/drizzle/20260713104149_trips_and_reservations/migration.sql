CREATE TABLE "trips" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"origin_ref" text NOT NULL,
	"provider" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'offered' NOT NULL,
	"driver_ref" text NOT NULL,
	"vehicle_ref" text NOT NULL,
	"depot_ref" text,
	"territory_ref" text,
	"order_ids" jsonb NOT NULL,
	"anchor_order_id" text,
	"stops" jsonb NOT NULL,
	"offer_expires_at" timestamp with time zone NOT NULL,
	"route_km" double precision,
	"route_minutes" double precision,
	"failure_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transport_orders" ADD COLUMN "reservation" jsonb;--> statement-breakpoint
CREATE INDEX "idx_trips_client_status" ON "trips" ("client_id","status");--> statement-breakpoint
CREATE INDEX "idx_trips_client_store" ON "trips" ("client_id","origin_ref","status");