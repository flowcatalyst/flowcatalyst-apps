DROP INDEX "idx_trips_client_store";--> statement-breakpoint
DROP INDEX "idx_activity_log_fulfilment";--> statement-breakpoint
CREATE INDEX "idx_activity_log_fulfilment" ON "activity_log" ("fulfilment_id","category");--> statement-breakpoint
DROP INDEX "idx_fulfilment_parts_release";--> statement-breakpoint
CREATE INDEX "idx_fulfilment_parts_release" ON "fulfilment_parts" ("release_at") WHERE status = 'pending';--> statement-breakpoint
DROP INDEX "idx_transport_orders_store_status";--> statement-breakpoint
CREATE INDEX "idx_transport_orders_store_status" ON "transport_orders" ("client_id","origin_ref","slot_start") WHERE status = 'requested';--> statement-breakpoint
CREATE INDEX "idx_fulfilments_client_slot" ON "fulfilments" ("client_id","slot_start");