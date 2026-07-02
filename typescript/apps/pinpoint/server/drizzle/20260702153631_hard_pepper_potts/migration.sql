-- Add locations.match_address (the editable "match address"). Backfill from
-- raw_address_line1 (the received address) for existing rows, then enforce
-- NOT NULL. Added nullable first so the backfill can run on existing data.
-- (The sessions table is created by its own earlier migration folder, so it is
-- intentionally omitted here despite the snapshot drift.)
ALTER TABLE "locations" ADD COLUMN "match_address" text;--> statement-breakpoint
UPDATE "locations" SET "match_address" = "raw_address_line1" WHERE "match_address" IS NULL;--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "match_address" SET NOT NULL;
