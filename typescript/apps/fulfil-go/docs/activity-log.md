# Activity log — the immutable chain record (design)

Status: direction agreed with Andrew 2026-07-12; generalization NOT built
(the fulfilment processing log is the live seed of this pattern).

## What it is

One append-only table recording everything that HAPPENED to a fulfilment's
chain — domain transitions, platform event receipts (including replays we
ACKed but ignored), third-party calls and their responses (Uber quote/book,
EPOD provisioning/route push), provider webhooks, admin actions. The
platform's msg_events is delivery infrastructure on another system and only
sees outbox traffic; THIS is the product's own story, queryable in one
place: `WHERE fulfilment_id = ? ORDER BY id`.

## Shape (generalizes the existing fulfilment_processing_log)

```
activity_log
  id bigserial
  client_id
  fulfilment_id      -- ROOT correlation, stamped by every writer; nullable
                     -- only for entries with no chain (picker admin, etc.)
  subject_type       -- 'fulfilment' | 'part' | 'pick' | 'transport_order'
  subject_id
  category           -- lifecycle | integration | webhook | provider-call |
                     -- provisioning | admin
  source             -- 'domain' | 'platform' | 'uber' | 'epod' | 'admin'
  actor              -- principal / picker / provider / system
  message            -- one human-readable sentence
  data jsonb         -- payload snapshot (captured value object, as-received)
  created_at
  index (client_id, fulfilment_id, id); index (subject_type, subject_id)
```

Correlation is CHEAP because the lower chain always knows its root: picks
carry fulfilment_id, transport orders will, parts do. Writers stamp the
root directly — no joins at read time. Adapters resolve providerRef →
transport order → fulfilment_id before appending webhook receipts.

## Rules

- **Same-tx for domain writes** (the existing processing-log pattern): a
  transition and its log entry commit or roll back together.
- **Best-effort-after for external interactions**: an Uber call gets logged
  after the response (there is no shared tx with Uber) — include
  request/response snapshots in `data`.
- **Append-only**: no update/delete code paths; optionally enforce with a
  Postgres trigger rejecting UPDATE/DELETE if hard guarantees are wanted.
- **Log the non-events too**: replayed webhooks ACKed with handled:false,
  rejected quotes, expired EPOD offers — the debugging gold is usually in
  what was IGNORED and why.
- **Retention**: long-lived (unlike sync_events, which prunes). Partition
  by month if volume ever demands.

## What it is NOT

- Not the SSE transport (sync_events — pruned, delivery-only).
- Not the analytics row (pick_sessions/projections — current-state flat
  records; the log is the narrative BEHIND them).
- Not an event store — aggregates stay state-persisted; this is
  observability, nothing ever reads it to decide.

## When to build (agreed 2026-07-12)

**Step 0 of the transport-context build — before any transport adapter
code writes state.** Rationale: transport is the moment the chain starts
spanning systems (platform events + Uber calls + EPOD provisioning/route
pushes) — the entries that justify the log's existence. Generalizing the
table FIRST means every adapter writes to it from day one instead of being
retrofitted, and the rename-while-small is cheap: today only the
fulfilment use cases write the processing log, so the migration touches
one repository and a handful of call sites.

Concretely, in order, as the opening commits of the transport branch:

1. Migration: create `activity_log` (+ migrate existing
   fulfilment_processing_log rows into it: subject_type='fulfilment',
   source='domain'); drop the old table.
2. Rename FulfilmentProcessingLogRepository → activity-log-repository
   (same same-tx append contract); update the fulfilment use-case call
   sites and the processing-log API route/panel.
3. Add writers to the PICK use cases (receive/claim/complete/fail) and to
   the process-manager webhook route — INCLUDING handled:false replay
   receipts.
4. Then build transport: every adapter interaction (quote, booking,
   provisioning dispatch, status webhook, EPOD offer/claim/expiry) appends
   from its first line of code.

Do NOT build it earlier than that: until transport lands, the fulfilment
processing log already covers the only context writing entries, and a
premature rename is churn without new information.
