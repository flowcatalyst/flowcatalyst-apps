ALTER TABLE "fulfilment_parts" RENAME COLUMN "requires_vehicle" TO "requires_car_or_larger";--> statement-breakpoint
ALTER TABLE "pick_sessions" RENAME COLUMN "requires_vehicle" TO "requires_car_or_larger";--> statement-breakpoint
ALTER TABLE "picks" RENAME COLUMN "requires_vehicle" TO "requires_car_or_larger";--> statement-breakpoint
ALTER TABLE "transport_orders" RENAME COLUMN "requires_vehicle" TO "requires_car_or_larger";