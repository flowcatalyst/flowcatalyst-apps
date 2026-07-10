ALTER TABLE "picks" ADD COLUMN "line_results" jsonb;--> statement-breakpoint
ALTER TABLE "picks" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "picks" ADD COLUMN "fail_reason" text;