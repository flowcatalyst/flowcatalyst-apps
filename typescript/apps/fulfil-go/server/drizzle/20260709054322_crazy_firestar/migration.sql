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
CREATE TABLE "idempotency_keys" (
	"key" varchar(128) PRIMARY KEY,
	"principal_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY,
	"status" varchar(20) DEFAULT 'created' NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"assignee_id" text,
	"assigned_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_events" (
	"id" bigserial PRIMARY KEY,
	"channel" varchar(128) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_locations" (
	"id" bigserial PRIMARY KEY,
	"principal_id" text NOT NULL,
	"uuid" varchar(64) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy" double precision,
	"speed" double precision,
	"heading" double precision,
	"altitude" double precision,
	"is_moving" boolean,
	"activity_type" varchar(32),
	"battery" jsonb,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_jobs_assignee" ON "jobs" ("assignee_id");--> statement-breakpoint
CREATE INDEX "idx_sync_events_channel_id" ON "sync_events" ("channel","id");--> statement-breakpoint
CREATE INDEX "idx_telemetry_principal_recorded" ON "telemetry_locations" ("principal_id","recorded_at");