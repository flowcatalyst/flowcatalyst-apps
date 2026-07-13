CREATE TABLE "client_settings" (
	"client_id" text PRIMARY KEY,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fulfilments" ADD COLUMN "process_definition" varchar(64) DEFAULT 'standard' NOT NULL;