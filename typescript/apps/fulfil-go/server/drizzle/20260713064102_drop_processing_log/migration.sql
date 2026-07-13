-- Migrate the existing fulfilment processing log into the generalized
-- activity_log (docs/activity-log.md): every historical entry was a domain
-- write about the fulfilment itself.
INSERT INTO "activity_log" ("client_id", "fulfilment_id", "subject_type", "subject_id", "at", "actor", "category", "source", "message", "data")
SELECT "client_id", "fulfilment_id", 'fulfilment', "fulfilment_id", "at", "actor", "category", 'domain', "message", "data"
FROM "fulfilment_processing_log"
ORDER BY "id";--> statement-breakpoint
DROP TABLE "fulfilment_processing_log";
