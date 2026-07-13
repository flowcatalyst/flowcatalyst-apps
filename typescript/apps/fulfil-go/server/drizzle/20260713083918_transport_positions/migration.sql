CREATE TABLE "transport_positions" (
	"id" text PRIMARY KEY,
	"client_id" text,
	"execution_system" varchar(32) NOT NULL,
	"vehicle_ref" text NOT NULL,
	"label" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"heading" double precision,
	"speed" double precision,
	"recorded_at" timestamp with time zone NOT NULL,
	"trip_ref" text,
	"meta" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_transport_positions_vehicle" ON "transport_positions" ("execution_system","vehicle_ref");--> statement-breakpoint
CREATE INDEX "idx_transport_positions_client" ON "transport_positions" ("client_id","recorded_at");