ALTER TABLE "fulfilment_parts" ADD COLUMN "line_results" jsonb;--> statement-breakpoint
ALTER TABLE "fulfilment_parts" ADD COLUMN "packages" jsonb;--> statement-breakpoint
ALTER TABLE "fulfilment_parts" ADD COLUMN "requires_vehicle" boolean;--> statement-breakpoint
ALTER TABLE "picks" ADD COLUMN "requires_vehicle" boolean;