CREATE TABLE "picks" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"store_ref" text NOT NULL,
	"fulfilment_id" text NOT NULL,
	"part_id" text NOT NULL,
	"short_id" text NOT NULL,
	"type" varchar(16) NOT NULL,
	"service_level" varchar(16) NOT NULL,
	"status" varchar(20) DEFAULT 'requested' NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"slot_end" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"origin" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"require_full_pick" boolean NOT NULL,
	"allow_substitutes" boolean NOT NULL,
	"released_late" boolean DEFAULT false NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"store_ref" text NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"region" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_picks_client_part" ON "picks" ("client_id","part_id");--> statement-breakpoint
CREATE INDEX "idx_picks_store_status" ON "picks" ("client_id","store_ref","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stores_client_ref" ON "stores" ("client_id","store_ref");