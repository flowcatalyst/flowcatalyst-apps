# Fulfilment context — design (draft for review)

Status update 2026-07-10: **the process manager's first slice is LIVE** —
the `fulfil-go-fulfilment-process` subscription delivers pick events to
`/processes/fulfilment`, which advances parts (`pick_requested → picking →
picked/short_picked/failed`) and derives fulfilment state (`ready` when all
viable parts picked → `fulfilment:picked`, the transport trigger; the
all-or-nothing policy fan-out cancels sibling parts and fails the
fulfilment → `fulfilment:failed`). Verified end-to-end against the live
platform both ways. Delivery gotchas: the Go platform sends `X-Event-Type`
(NOT the Rust-era `x-fc-event-type`) and dataOnly payloads can arrive as a
JSON-encoded STRING — the webhook tolerates both. Next: request-transport
on ready (time-based), handover, completion.

Status: agreed in discussion 2026-07-09. **create-fulfilment AND cancel-fulfilment are implemented**
(shared contracts, aggregate + parts/lines, short-id allocator, processing
log, `POST/GET /clients/:clientId/fulfilments`, `fulfilment.created` outbox
event; cancel with optimistic locking verified under a concurrency race, `fulfilment.cancelled` event) — the rest of the process manager is not. House conventions (optimistic locking everywhere, `eventGroup(aggregateCode, aggregateId)` message groups, framework branded TSIDs) are in CLAUDE.md. The demo `jobs` vertical in
the scaffold is throwaway — this context replaces it as the first real
subdomain.

## Context map

- **fulfilment** (this doc) — the coordinator. Owns the Fulfilment aggregate,
  runs the process manager that listens to all other contexts' events (via
  FlowCatalyst subscriptions → webhooks) and issues the next command (dispatch
  jobs or direct API requests). It ensures everything that must happen for a
  fulfilment happens; it does NOT do the work.
- **pick** — manages picks per store, emits domain events through its use
  cases. Receives create-pick requests keyed to a fulfilment **part**;
  hydrates substitutes itself from external master data (fulfilment never
  sends or stores substitutes).
- **master data** — external system(s). We interface to read; we never rely
  on it after creation: everything the process needs is captured ON the
  fulfilment at creation time and is immutable from then on.
- **pinpoint** — spatial service/delivery areas + fulfilment products. Used
  upstream to _create_ the fulfilment request; the fulfilment stores
  provenance references only (they don't participate in the process).

Multi-tenant throughout: `clientId` (TSID) on every aggregate, every
uniqueness constraint, and stamped into event subject/messageGroup. Requests
are path-scoped pinpoint-style (`/clients/:clientId/...`) and validated
against token claims.

## Aggregate: Fulfilment

Immutable after creation except for process state. **No amendments — cancel
only.** Create is idempotent on `(clientId, externalSource, externalRef)`
(unique constraint = integration dedupe).

```
Fulfilment
├── id                  ful_<tsid>
├── clientId            tenant (TSID)
├── externalSource      which upstream system (e.g. 'shopify', 'sap-commerce')
├── externalRef         upstream's id — what we key back on
├── type                'delivery' | 'collect'        (per fulfilment)
├── serviceLevel        'ASAP' | 'STANDARD'
├── slotStart/slotEnd   UTC instants
├── timezone            IANA string — display + day-scoping only, never arithmetic
├── destination         by type (see Destinations)
├── policies
│   ├── allowSubstitutes        default for lines (line value can override)
│   └── allowPartialFulfilment  ONE promise, expressed at two levels: false =
│                               all-or-nothing (short picks not acceptable AND
│                               any part failure fails the whole fulfilment).
│                               The pick context has its own requireFullPick
│                               flag on the create-pick contract — fulfilment
│                               hydrates it as !allowPartialFulfilment at the
│                               boundary. Pick never knows fulfilment policy.
├── provenance          pinpoint refs: fulfilmentProductId, deliveryAreaId, … (reference only)
├── additionalData      Record<string,string> — opaque pass-through cargo,
│                       never read by process logic; hygiene-validated only
└── parts[]             1..n — see Part
```

### Part (name settled: `part`)

The unit of coordination: one origin (store), its lines, its pick, its
collection stop. A part maps ~1:1 to a pick request in the pick context.
Failure isolation is per part.

```
Part
├── id                fpt_<tsid>
├── shortId           4–6 digits, human quick-reference (see Short ids)
├── origin            captured location value object (see Locations)
├── lines[]           owned by the part — a commerce line belongs to exactly
│                     ONE part (no splitting across origins)
└── state             the state machine lives here (see State)
```

### Line (value object, immutable)

```
Line
├── externalLineRef   upstream line id — outcome reporting keys on this
├── sku / gtin / description / imageUrl?
├── quantity          integer count of units
├── volumetric        value object: weight (authoritative — the weight
│                     received here is what matters, always), dimensions?
├── temperatureClass  'ambient' | 'chilled' | 'frozen' (default ambient) —
│                     informs the pick context's packaging requirements
├── allowSubstitutes? overrides the fulfilment default when present
└── attributes        product attributes as received (shaped/enriched upstream)
```

Notes:

- Weight semantics: the volumetric on the line is the source of truth for
  weight for the entire chain. Substitutes are treated as having the same
  volumetric (slight differences don't matter). Packing units are driven
  later through standard sizes chosen during pick — but weight always comes
  from here.
- Lines _reference_ master data (sku etc.) but never _rely_ on it — the line
  carries everything the process needs.

### Locations (captured value objects — deliberately NOT called snapshots)

Origin and destination are value objects captured at creation. They are often
copies of upstream data but may be shaped, trimmed or enriched by the
creating integration — so they are "as-received captured data", not snapshots
of a system of record. Shape borrows from fulfil's lastmile value objects
(`Address`, `GeoPoint`, `ContactRef`, `AccessConstraints`, collection-point
details): everything needed to locate the place and collect/hand over goods.

### Destinations by type

- `delivery` → destination is a drop-off location value object (customer
  address + contact + access notes).
- `collect` → destination is a **collection point**: a real entity associated
  with stores (many-to-many — one collection point can serve many stores, so
  a multi-part collect fulfilment still has ONE destination). Captured on the
  fulfilment as `collectionPointRef + captured location value object`.
  Validation that the collection point serves the origin store(s) happens at
  creation-request time, upstream — fulfilment accepts what it is given.

`type` is per fulfilment — no mixed delivery/collect within one fulfilment.

### Short ids

- Allocated **per part**, scope `(clientId, originLocationRef, service-day)`
  where service-day = slot-START date in the fulfilment's timezone.
- Sequential counter table per scope (not random): no birthday collisions at
  busy-store volume, and roughly ordered numbers help floor staff. 4–6 digits,
  not globally unique — quick verbal/visual reference only.

### Processing log

Append-only side table (`fulfilment_processing_log`): `at`, `actor`,
`category`, `message`, `data jsonb`, written **in the same tx** as the state
change it describes (same pattern as `sync_events`). Observability only —
nothing reads it to make decisions. Not part of the aggregate (unbounded
growth stays out of the optimistic-concurrency payload).

## State

The state machine lives on the **part**; the fulfilment's status is largely
derived from its parts plus the delivery/handover leg. Sketch (to be refined
at implementation):

```
Part:      pending → pick_requested → picking → picked
                                     ↘ short_picked (requireFullPicks ⇒ failed)
           picked/short_picked → ready → handed_over → completed
           any → failed | cancelled

Fulfilment: created → in_progress → ready → completing →
            completed | partially_completed | failed | cancelled
            (derived; `cancelling` exists because cancel fans out async)
```

Policy interactions:

- `allowPartialFulfilment = true`: picks may complete short
  (`requireFullPick=false` hydrated onto the pick), and when a part fails the
  remaining viable parts continue — fulfilment can end `partially_completed`.
- `allowPartialFulfilment = false`: picks are all-or-nothing
  (`requireFullPick=true`), and any part failure makes the process manager
  cancel the other parts and fail the fulfilment.
- Fixed at creation (immutability).

## Process manager

Follows fulfil's `LastMileFulfilment` pattern: reaction bookkeeping
(`awaitingEventType`, deadline, idempotency key per reaction), deciders per
inbound event, commands out as platform dispatch jobs or direct API calls.
ASAP service level ⇒ deadline timers on each await (sweep via croner or
platform scheduled jobs).

Inbound (subscribed via FlowCatalyst → HMAC webhook): pick context events
(accepted / completed / short / failed / cancelled), delivery-leg events,
plus its own timer sweeps. Outbound events (`fulfil-go:fulfilment:*`):
created, part-state changes, cancelled, completed, partially-completed,
failed — payloads carry `additionalData` only where the integration chain
needs it (it's cargo; don't put it on every event).

## Pick release (IMPLEMENTED)

Rules (settled with Andrew): `releaseAt` precomputed per part at creation —
ASAP = immediately, STANDARD = `slotStart − pickLeadTimeMinutes` (command
field; integration passes per-store/global settings from upstream, defaults
90 delivery / 60 collect). Always release regardless of lateness (late is
logged + flagged on the event; no blocking, no extra part state). The
platform scheduled job `fulfil-go-release-picks` (every minute) POSTs the
HMAC-verified `/jobs/release-picks` webhook; the sweep is a dumb reconciler —
per part, in ONE tx: `pending → pick_requested` (fulfilment `created →
in_progress`), processing log, `part.pick-requested` EVENT (fact), and a
`create-pick` DISPATCH JOB (command — platform-delivered with retries) whose
payload hydrates `requireFullPick = !allowPartialFulfilment` at the boundary.
`POST /clients/:clientId/picks` is the pick context's landing pad (acks +
logs receipt until the real context replaces it).

## Build prerequisites (gaps in the current scaffold)

1. Inbound platform webhook machinery (process-webhook + HMAC auth hook —
   pattern exists in fulfil; port to fulfil-go).
2. Plain-async `DispatchJobBroker` (app-framework has the Effect path only).
3. Tenancy plumbing: path-scoped `clientId` + token-claim validation on the
   request scope (pinpoint convention).
4. External master-data interface (consumed by the pick context for
   substitute hydration — an anti-corruption gateway, not fulfilment's
   concern).

## Open questions (parked)

- Who owns collection-point reference data (tenant config in fulfil-go vs
  upstream)? Fulfilment only captures it, but _something_ serves the
  creation-time validation.
- Cancellation while a pick is mid-flight: cancel-pick semantics belong to
  the pick context; fulfilment's `cancelling` state awaits its outcome.
- Exact event catalogue + payload schemas — write when implementing
  (TypeBox `*EventType` consts, synced to the platform).
