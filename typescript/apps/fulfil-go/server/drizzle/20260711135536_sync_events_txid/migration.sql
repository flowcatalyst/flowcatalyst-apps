ALTER TABLE "sync_events" ADD COLUMN "txid" xid8 DEFAULT pg_current_xact_id() NOT NULL;
--> statement-breakpoint
-- Multi-node SSE nudge: NOTIFY is delivered on COMMIT, so every node's
-- broker wakes exactly when new rows become visible. A trigger (rather than
-- app-level NOTIFY) means no future write path can forget it.
CREATE OR REPLACE FUNCTION fulfilgo_notify_sync_events() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('fulfilgo_sync', '');
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_sync_events_notify
AFTER INSERT ON "sync_events"
FOR EACH STATEMENT EXECUTE FUNCTION fulfilgo_notify_sync_events();