CREATE TABLE "request_logs" (
	"id" text PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" text,
	"partition_id" text,
	"principal_id" text,
	"operation" text NOT NULL,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"url" text NOT NULL,
	"status_code" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"request_body" jsonb,
	"response_body" jsonb
);
--> statement-breakpoint
CREATE INDEX "idx_request_logs_created" ON "request_logs" ("created_at");--> statement-breakpoint
CREATE INDEX "idx_request_logs_client_created" ON "request_logs" ("client_id","created_at");