CREATE TABLE "driver_users" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"store_ref" text NOT NULL,
	"display_name" text NOT NULL,
	"staff_code" text NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"default_vehicle_reg" text,
	"pin_hash" text,
	"failed_pin_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_driver_users_staff_code" ON "driver_users" ("client_id","store_ref","staff_code");