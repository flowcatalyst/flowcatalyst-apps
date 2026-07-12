CREATE TABLE "store_profiles" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "profile_code" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "settings_overrides" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_store_profiles_client_code" ON "store_profiles" ("client_id","code");