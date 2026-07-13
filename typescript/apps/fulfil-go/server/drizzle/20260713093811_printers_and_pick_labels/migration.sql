CREATE TABLE "printers" (
	"id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"store_ref" text NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 9100 NOT NULL,
	"dpi" integer DEFAULT 203 NOT NULL,
	"label_width_mm" integer DEFAULT 100 NOT NULL,
	"label_height_mm" integer DEFAULT 75 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "picks" ADD COLUMN "labels" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_printers_client_store_name" ON "printers" ("client_id","store_ref","name");