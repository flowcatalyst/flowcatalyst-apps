CREATE TABLE "fulfilment_parts" (
	"id" text PRIMARY KEY,
	"fulfilment_id" text NOT NULL,
	"client_id" text NOT NULL,
	"short_id" varchar(6) NOT NULL,
	"origin_ref" varchar(64) NOT NULL,
	"origin" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfilment_processing_log" (
	"id" bigserial PRIMARY KEY,
	"client_id" text NOT NULL,
	"fulfilment_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"category" varchar(32) NOT NULL,
	"message" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "fulfilments" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"external_source" varchar(64) NOT NULL,
	"external_ref" varchar(128) NOT NULL,
	"type" varchar(16) NOT NULL,
	"service_level" varchar(16) NOT NULL,
	"status" varchar(24) DEFAULT 'created' NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"slot_end" timestamp with time zone NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"destination" jsonb NOT NULL,
	"policies" jsonb NOT NULL,
	"provenance" jsonb,
	"additional_data" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "short_id_counters" (
	"client_id" text,
	"origin_ref" varchar(64),
	"service_day" varchar(10),
	"next_value" integer NOT NULL,
	CONSTRAINT "short_id_counters_pkey" PRIMARY KEY("client_id","origin_ref","service_day")
);
--> statement-breakpoint
CREATE INDEX "idx_fulfilment_parts_fulfilment" ON "fulfilment_parts" ("fulfilment_id");--> statement-breakpoint
CREATE INDEX "idx_fulfilment_parts_short" ON "fulfilment_parts" ("client_id","origin_ref","short_id");--> statement-breakpoint
CREATE INDEX "idx_fulfilment_log_fulfilment" ON "fulfilment_processing_log" ("fulfilment_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_fulfilments_external" ON "fulfilments" ("client_id","external_source","external_ref");--> statement-breakpoint
CREATE INDEX "idx_fulfilments_client_created" ON "fulfilments" ("client_id","created_at");