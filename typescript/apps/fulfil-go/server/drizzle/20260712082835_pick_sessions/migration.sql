CREATE TABLE "pick_sessions" (
	"pick_id" text PRIMARY KEY,
	"client_id" text NOT NULL,
	"store_ref" text NOT NULL,
	"fulfilment_id" text NOT NULL,
	"part_id" text NOT NULL,
	"short_id" text NOT NULL,
	"service_level" varchar(16) NOT NULL,
	"require_full_pick" boolean NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"released_late" boolean DEFAULT false NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"picker_id" text,
	"handling_seconds" integer,
	"outcome" varchar(20),
	"fail_reason" text,
	"lines_total" integer NOT NULL,
	"units_total" integer NOT NULL,
	"units_picked" integer,
	"units_substituted" integer,
	"packages_count" integer,
	"bag_sizes" jsonb,
	"requires_vehicle" boolean,
	"on_time" boolean,
	"in_full" boolean,
	"source" text DEFAULT 'fulfil-go' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_pick_sessions_store_slot" ON "pick_sessions" ("client_id","store_ref","slot_start");--> statement-breakpoint
CREATE INDEX "idx_pick_sessions_claimed" ON "pick_sessions" ("client_id","claimed_at");--> statement-breakpoint
-- Backfill sessions from existing picks (handling time = claim→complete;
-- pack split deferred). Idempotent via ON CONFLICT.
INSERT INTO pick_sessions (
  pick_id, client_id, store_ref, fulfilment_id, part_id, short_id,
  service_level, require_full_pick, slot_start, released_late,
  requested_at, claimed_at, completed_at, picker_id, handling_seconds,
  outcome, fail_reason, lines_total, units_total, units_picked,
  units_substituted, packages_count, bag_sizes, requires_vehicle,
  on_time, in_full, updated_at
)
SELECT
  p.id, p.client_id, p.store_ref, p.fulfilment_id, p.part_id, p.short_id,
  p.service_level, p.require_full_pick, p.slot_start, p.released_late,
  p.created_at, p.claimed_at, p.completed_at, p.claimed_by,
  CASE WHEN p.completed_at IS NOT NULL AND p.claimed_at IS NOT NULL
       THEN GREATEST(0, EXTRACT(EPOCH FROM p.completed_at - p.claimed_at))::int END,
  CASE WHEN p.status IN ('picked','short_picked','failed') THEN p.status END,
  p.fail_reason,
  COALESCE(jsonb_array_length(p.lines), 0),
  COALESCE((SELECT sum((l->>'quantity')::int) FROM jsonb_array_elements(p.lines) l), 0),
  (SELECT sum((r->>'pickedQuantity')::int) FROM jsonb_array_elements(p.line_results) r),
  (SELECT sum(COALESCE((SELECT sum((s->>'quantity')::int)
                        FROM jsonb_array_elements(r->'substitutions') s), 0))
   FROM jsonb_array_elements(p.line_results) r),
  CASE WHEN p.packages IS NOT NULL THEN jsonb_array_length(p.packages) END,
  (SELECT jsonb_agg(pk->'size') FROM jsonb_array_elements(p.packages) pk
   WHERE pk->>'size' IS NOT NULL),
  p.requires_vehicle,
  CASE WHEN p.completed_at IS NOT NULL THEN p.completed_at <= p.slot_start END,
  CASE WHEN p.status IN ('picked','short_picked','failed') THEN p.status = 'picked' END,
  now()
FROM picks p
ON CONFLICT (pick_id) DO NOTHING;
--> statement-breakpoint
-- Stats are SQL over sessions — views first, rollups only when measured-slow
-- (docs/projections.md). The demo: the operational DB answers this live.
CREATE OR REPLACE VIEW pick_stats_daily AS
SELECT
  client_id,
  store_ref,
  date_trunc('day', COALESCE(claimed_at, requested_at)) AS day,
  count(*)                                                    AS picks_requested,
  count(*) FILTER (WHERE outcome IS NOT NULL)                 AS picks_completed,
  count(*) FILTER (WHERE outcome = 'failed')                  AS picks_failed,
  round(avg(handling_seconds))                                AS avg_handling_seconds,
  round(avg(units_picked / nullif(handling_seconds / 60.0, 0))::numeric, 2)
                                                              AS units_per_minute,
  round((count(*) FILTER (WHERE on_time))::numeric
        / nullif(count(*) FILTER (WHERE outcome IS NOT NULL), 0), 3)
                                                              AS on_time_rate,
  round((count(*) FILTER (WHERE in_full))::numeric
        / nullif(count(*) FILTER (WHERE outcome IS NOT NULL), 0), 3)
                                                              AS in_full_rate,
  sum(units_picked)                                           AS units_picked,
  sum(units_substituted)                                      AS units_substituted
FROM pick_sessions
GROUP BY 1, 2, 3;
--> statement-breakpoint
CREATE OR REPLACE VIEW pick_stats_by_picker AS
SELECT
  ps.client_id,
  ps.store_ref,
  ps.picker_id,
  pu.staff_code,
  pu.display_name,
  count(*) FILTER (WHERE ps.outcome IS NOT NULL)  AS picks_completed,
  round(avg(ps.handling_seconds))                 AS avg_handling_seconds,
  round(avg(ps.units_picked / nullif(ps.handling_seconds / 60.0, 0))::numeric, 2)
                                                  AS units_per_minute,
  round((count(*) FILTER (WHERE ps.on_time))::numeric
        / nullif(count(*) FILTER (WHERE ps.outcome IS NOT NULL), 0), 3)
                                                  AS on_time_rate
FROM pick_sessions ps
LEFT JOIN picker_users pu ON pu.id = ps.picker_id
GROUP BY 1, 2, 3, 4, 5;
