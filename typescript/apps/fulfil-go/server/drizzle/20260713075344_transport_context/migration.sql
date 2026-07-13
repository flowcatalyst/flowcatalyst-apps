CREATE TABLE "process_reactions" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"fulfilment_id" text NOT NULL,
	"kind" varchar(40) NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_orders" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"fulfilment_id" text NOT NULL,
	"part_id" text NOT NULL,
	"short_id" text NOT NULL,
	"status" varchar(20) DEFAULT 'requested' NOT NULL,
	"service_level" varchar(16) NOT NULL,
	"origin_ref" text NOT NULL,
	"origin" jsonb NOT NULL,
	"destination" jsonb NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"slot_end" timestamp with time zone NOT NULL,
	"parcels" jsonb NOT NULL,
	"requires_vehicle" boolean DEFAULT false NOT NULL,
	"provider" varchar(32) NOT NULL,
	"candidate_providers" jsonb NOT NULL,
	"provider_ref" text,
	"tracking_url" text,
	"courier" jsonb,
	"failure_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_process_reactions_kind_fulfilment" ON "process_reactions" ("kind","fulfilment_id");--> statement-breakpoint
CREATE INDEX "idx_process_reactions_due" ON "process_reactions" ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_transport_orders_client_part" ON "transport_orders" ("client_id","part_id");--> statement-breakpoint
CREATE INDEX "idx_transport_orders_client_status" ON "transport_orders" ("client_id","status");--> statement-breakpoint
CREATE INDEX "idx_transport_orders_fulfilment" ON "transport_orders" ("client_id","fulfilment_id");--> statement-breakpoint
CREATE INDEX "idx_transport_orders_provider_ref" ON "transport_orders" ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "idx_transport_orders_store_status" ON "transport_orders" ("client_id","origin_ref","status");