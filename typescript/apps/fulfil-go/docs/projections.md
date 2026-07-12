# Projections — session tables + stats (design)

Status: direction agreed with Andrew 2026-07-12; NOT built (supersedes the
earlier flightboard-projection sketch — ONE projection family, not two).
Purpose: flat, denormalized, business-readable tables written at domain
transitions — `SELECT * FROM pick_sessions WHERE store_ref = …` answers
questions that legacy systems need CDC→Redshift→PowerBI and a joins maze
for. The demo IS the architecture argument.

## The session family

One row per unit of work, DENORMALIZED on purpose (names/refs inline; soft
references only — the anti-pattern being demonstrated against is FK-maze
over-normalization). Written transactionally in the same tx as the domain
transition (the sync_events pattern), so they are crash-consistent and
real-time — no ETL lag.

```
pick_sessions        one row per pick (the store-side work session)
  pick_id, client_id, store_ref, store_name, fulfilment_id, part_id,
  short_id, external_ref, service_level, requires_full_pick,
  picker_id, picker_staff_code, picker_name,
  requested_at, claimed_at, packing_started_at*, completed_at,
  picking_seconds*, packing_seconds*,            -- * see timing signal
  outcome (picked|short_picked|failed), fail_reason,
  lines_total, units_total, units_picked, units_short, substitutions,
  packages_count, bag_sizes jsonb, requires_vehicle,
  slot_start, released_late, on_time boolean (completed ≤ slot_start),
  in_full boolean, source DEFAULT 'fulfil-go', updated_at

fulfilment_sessions  one row per fulfilment (the whole journey)
  fulfilment_id, client_id, external_source/ref, type, service_level,
  slot_start/end, timezone, stores text[], parts_total,
  created_at, first_released_at, first_claimed_at, all_picked_at,
  ready_at, transport_requested_at†, collected_at†, delivered_at†,
  terminal_status, terminal_at,
  seconds_to_ready, seconds_to_deliver†, on_time†, otif†, source

transport_sessions   one row per transport order († lands with transport)
  transport_order_id, provider, provider_ref, fulfilment_id, part_ids,
  store_ref, requested_at, booked_at, assigned_at, collected_at,
  delivered_at/failed_at, fee_cents, courier_vehicle_type, …
```

- **The flightboard reads the same tables** (active-window subset, covered
  index on (client_id, store_ref, slot_start)); stats read the completed
  subset. One write path serves ops-now AND analytics-history.
- **`source`** keeps the external-hydration seam: an old system's records
  upsert as `source='external:<system>'`, display/aggregate-only.
- Exceptions stay DERIVED (timestamps + store-profile thresholds at read
  time) — writers know nothing about SLAs.

## Stats: views first, rollups only when measured-slow

`pick_stats` should NOT be a maintained table on day one — every hand-
maintained aggregate is a consistency liability. Stats are SQL over
sessions:

```sql
CREATE VIEW pick_stats_daily AS
SELECT client_id, store_ref, date_trunc('day', claimed_at) AS day,
       count(*) FILTER (WHERE outcome IS NOT NULL)            AS picks,
       avg(picking_seconds)                                   AS avg_pick_s,
       avg(packing_seconds)                                   AS avg_pack_s,
       avg(units_picked / nullif(picking_seconds/60.0, 0))    AS units_per_min,
       count(*) FILTER (WHERE on_time)::float / nullif(count(*),0)  AS on_time_rate,
       count(*) FILTER (WHERE in_full)::float / nullif(count(*),0)  AS in_full_rate
FROM pick_sessions GROUP BY 1,2,3;
```

Per-picker, per-profile, per-slot-hour = more views. Promote a view to a
timer-refreshed rollup table ONLY when a dashboard measurably needs it.
That story ("the operational DB just answers this, live") is the demo.

## The timing signal (DECIDED 2026-07-12: combined)

Andrew's call: pick+pack COMBINED — `handling_seconds` = claim→complete,
both server-observable, no app changes. (Context: the split is not
server-observable — the pick→pack transition is station-side state.) If
the split is ever wanted:

- **The station reports DURATIONS in the completion payload**
  (`timings: { pickingSeconds, packingSeconds }`, measured locally from
  claim→pack-stage-entry→complete). Duration-not-timestamp makes it immune
  to station clock skew and offline-queue delay (a completion replayed 20
  minutes later still carries true durations). One schema field, no new
  lifecycle state, offline-safe.
- Optional later: a lightweight `packing-started` signal for LIVE "packing
  now" state on the flightboard — nice for ops, unnecessary for stats.
- Backfill/degrade: sessions built from historical picks get
  picking_seconds = claimed→completed and packing NULL — stats views must
  tolerate NULL packing (they do, avg ignores NULLs).

## Build order

1. DONE 2026-07-12: `pick_sessions` (schema/pick-sessions.ts, writer
   pick-session-projection.ts riding the receive/claim/complete/fail txs,
   idempotent full-row upserts) + BACKFILL from historical picks in the
   migration + views `pick_stats_daily` / `pick_stats_by_picker`.
2. `fulfilment_sessions` (writers in create/PM reactions) + stats views +
   a management "Stats" page (tiles + per-store table over the views).
3. Flightboard re-reads from sessions (drop the in-process join module).
4. `transport_sessions` with the transport context; delivery-side columns
   unlock delivered/on-time/OTIF everywhere.
