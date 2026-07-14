ALTER TABLE "fulfilment_parts" ADD COLUMN "pickup_pin" varchar(8);--> statement-breakpoint
ALTER TABLE "fulfilments" ADD COLUMN "handover_policy" jsonb;--> statement-breakpoint
ALTER TABLE "fulfilments" ADD COLUMN "delivery_pin" varchar(8);--> statement-breakpoint
ALTER TABLE "fulfilments" ADD COLUMN "max_restricted_age" integer;