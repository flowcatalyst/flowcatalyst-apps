# fulfil-go — handoff / pickup state

Last updated: 2026-07-11. Everything below is MERGED to `main` (@ `6e6f852`,
branch `feat/fulfil-go-pick-claim` == main). Read `CLAUDE.md` first (stack,
conventions, gotchas, dev loop); this file is "where we are + what's next".

## What works, end-to-end, against the LIVE fc-dev platform

The full demo loop is autonomous and verified:

```
Generator (management app, optionally per-store)
  → create-fulfilment (parts pending)
  → platform cron fulfil-go-release-picks (client-scoped job, 6-FIELD cron
    '0 * * * * *') fires /jobs/release-picks every minute
  → parts pick_requested + create-pick DISPATCH JOB (outbox → platform)
  → platform dispatcher POSTs /clients/:id/picks (HMAC; idempotent intake)
  → Pick aggregate 'requested' → SSE store channel → picking station LIVE
  → picker claims (online-only by design) → pick:claimed event
  → platform SUBSCRIPTION fulfil-go-fulfilment-process delivers to
    /processes/fulfilment → PROCESS MANAGER: part → picking
  → picker picks (scan-first wedge input; substitutes when allowed; walk-
    order by attributes.aisle; images) → packs (pick-then-pack; bag drawer
    with size/temp squares; items-into-bags or bags-only) → vehicle question
    (big NO default / double-confirmed Yes) → complete
  → pick:picked/short-picked → PM: part picked + ACTUALS captured on the
    part (line_results incl substitutions, packages, requires_vehicle)
  → all viable parts picked ⇒ fulfilment READY + fulfilment:picked event
    (the future request-transport trigger)
  fail path: pick:failed → all-or-nothing cancels sibling parts +
    fulfilment FAILED + fulfilment:failed
```

Offline: complete/fail queue client-side (2.5s→10s backoff cap, network
errors never dead-letter, Idempotency-Key + server replay); WIP trolley
persists per pick in localStorage; dead-letter UI in station Settings.

## Contexts & status

| Context         | State                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fulfilment      | create/cancel/release + PM first slice (pick reactions, ready/failed derivation). Missing: transport request on ready, handover, completion, cancel-while-picking (`cancelling`).                                                                                                           |
| Pick            | Full: intake, claim, pick-then-pack, substitutes (captured-as-scanned), outcomes, packages, requiresVehicle. Missing: pick-into-bag-directly mode (needs pick_lines as ROWS — see picking-workflow.md), approved-substitute lists (master-data gateway).                                    |
| Picker identity | PIN-primary complete (login/refresh/lifecycle/seeding, dev PIN 385345). Missing: QR badges, device enrollment, break-glass (pick-context-auth-plan.md phases).                                                                                                                              |
| Stores          | Base registry section (sync from fixtures). Real master-data sync later; transport config per store later.                                                                                                                                                                                  |
| Transport       | Aggregate NOT BUILT, but the provider port + FULL UBER DIRECT ADAPTER exist (server/src/transport/ — typed client, quote/create/cancel, webhook verify, robo-courier test mode, 15 tests; see transport-context.md "Uber Direct adapter"). All inputs already captured on fulfilment parts. |
| Jobs (demo)     | Throwaway vertical; still powers execution-app. Candidate backend for the 'own' transport adapter — DECIDE before transport build (vs fulfil's last-mile).                                                                                                                                  |

## Agreed next steps (priority order per Andrew's direction)

1. **Transport context** (the big one): TransportOrder aggregate, provider
   port ('own' driver execution for ROA stores, 'uber' Direct, 'inmotion'),
   store/client provider config + store `geo` + PostGIS coverage oracle
   (transport-context.md "Provider selection & coverage"), PM requests
   transport on READY (ASAP immediate, STANDARD timed via reaction
   bookkeeping + deadline sweep). STEP 0 of this build: generalize the
   processing log into the ACTIVITY LOG (docs/activity-log.md — table +
   activity-log-repository rename + pick/PM writers) so every transport
   adapter writes the chain record from day one. Alongside it: the
   process-definition registry + ownership stamp + client integration
   processes (docs/process-definitions.md), planning context + EPOD channel
   (transport-context.md "Execution channels"). Open decision: 'own'
   adapter backend = execution-app jobs vs fulfil last-mile.
2. Fulfilment completion leg: PM consumes transport events → ready →
   completing → completed/partially_completed.
3. Pick-into-bag-directly mode (+ per-line server-side state as rows).
4. Picker auth phase 2: QR badges + device enrollment + break-glass.

## Known issues / loose ends (not fulfil-go blockers)

- **pinpoint shares the pool-self-deadlock pattern** (bare `db.` reads inside
  runWrite) — MUST sweep before its prod cutover. Fix pattern: `const
current = () => resolveDb(db, TransactionStore.get())` (see fulfil-go
  repos + CLAUDE.md gotcha).
- pinpoint `test/auth/session-refresh.test.ts`: 2 pre-existing failures
  (mocked happy path returns undefined; possibly SDK-bump related).
- Two `fc-dev outbox` poller processes tend to accumulate — kill duplicates.
- Platform observations flagged to Andrew: dataOnly subscription payloads
  arrive double-encoded (JSON string); 5-field crons validate but never fire
  (his other session is fixing validation); scheduled-job client-scope
  migration strands the old platform-scoped duplicate (archiveUnlisted can't
  reach it — deleted manually via API).
- TypeScript 7: repo stays on TS6 until 7.1 (vue-tsc needs the new API);
  Andrew's ~/.Brewfile has a note; brew formula still 6.0.3.
- **Store profiles LIVE 2026-07-12** (config vertical): layered operational
  settings — code defaults ⇐ 'default' profile (THE global config; virtual
  until first saved) ⇐ store's profile ⇐ store overrides. Shared contract
  `StoreSettingsSchema` (+ resolveStoreSettings); tables store_profiles +
  stores.profile_code/settings_overrides; API /clients/:id/config/\*;
  management "Configuration → Store profiles" page + per-store profile
  select on Stores. CONSUMERS: create-fulfilment hydrates per-part pick
  lead times when the command omits pickLeadTimeMinutes (explicit upstream
  values ALWAYS win); flightboard thresholds resolve live per store.
  Dev note: a 'dark-store' demo profile exists, store-001 assigned to it.
  Store-override editing UI not built (API is).
- **Flightboard SSE LIVE 2026-07-12**: /clients/:id/sse/ops streams
  invalidation nudges (broker wildcard '\*' subscription filtered to the
  client's store channels); page debounce-refetches, badge shows
  live/polling, poll stays as fallback (15s) and safety net (60s when SSE
  open — covers signals store channels don't carry, e.g. creation).
- Projections (docs/projections.md — session tables + stats-as-views, the
  anti-CDC/Redshift demo story): **pick_sessions LIVE 2026-07-12** —
  flat row per pick written in the pick txs (receive/claim/complete/fail,
  idempotent full-row upserts via pick-session-projection.ts), BACKFILLED
  from historical picks in the migration, `handling_seconds` =
  claim→complete COMBINED (Andrew's call; split needs station-reported
  durations — option documented). Views `pick_stats_daily` +
  `pick_stats_by_picker` (join picker names) query live. NEXT:
  fulfilment_sessions + Stats page; flightboard re-reads sessions;
  transport_sessions with transport.
- EPOD/Integral execution system: **docs/epod-integration-notes.md
  WRITTEN 2026-07-12** (880 lines, file-cited from InhanceMono) — feeds the
  'epod' transport provider adapter. Essence: claim is a DRIVER-PULL
  marketplace (claimable-trips offer w/ 30s TTL + claim-trip/{groupId}; no
  unclaim, offers expire; driver+vehicle bound at OFFER time) built on
  ondemand's od*transport_orders (status ready, execution_system='EPOD')
  over a SHARED DB with epod*\* tables. Events: EPOD.STOP.STATUS.CHANGED /
  epod.POD.GENERATED / workflow + allocation events; outbound today =
  Basic-auth Actuals POST (CLIENT_CONFIG/EPOD_ACTUALS) or WEBHOOK_CE
  connector subs; an Integral→FlowCatalyst sync bridge already exists.
  Adapter considerations: claim endpoints will PROXY to fulfil-go (their
  driver app unchanged); route-plan push becomes a new SYNCHRONOUS EPOD
  ingest endpoint (explicit accept/reject) protected by FlowCatalyst
  tokens via existing middleware alias 'fc.or-passport'; provisioning
  (destinations+products) via PM dispatch job on fulfilment.created when
  EPOD is default/available; origin = part origin.ref == EPOD location
  reference (depots/territories manually maintained there); tenant match =
  our client code == EPOD tenant code; map statuses ONLY on string
  references (numeric ids differ per tenant). Migration is proposed for a
  focused ondemand execution experience, adopted incrementally per store.
- Flightboard (management /flightboard, GET /clients/:id/flightboard):
  controller view LIVE 2026-07-12 — KPIs, exception list (release_overdue /
  pick_late_unclaimed / pick_late_incomplete; transport kinds reserved),
  ASAP-first board, 15s poll. Thresholds are v1 constants in
  flightboard-query.ts — promote to client/store config when controllers
  want tuning. Delivery-side KPIs (delivered, on-time, OTIF) render as
  "awaits transport" until that context lands. NOTE: "claimed but not
  STARTED" is indistinguishable server-side until pick_lines become rows.
- Fulfilments page could render the captured part ACTUALS (line_results/
  packages/requiresVehicle are already on the DTO) — small UI win.
- Offered, not built: management "Products" reference page (sku/gtin lookup
  - rendered barcodes for scan testing).

## Debugging the platform (hard-won)

- Query the platform DB directly: same embedded PG :15432, database
  `flowcatalyst` — `msg_events` (projected_at/fanned_out_at), `msg_dispatch_jobs`
  (status/attempt_count/last_error — subscription deliveries live here),
  `msg_scheduled_job*`. App DB is `fulfilgo`.
- Platform API: client-credentials token via POST :8080/oauth/token with
  FLOWCATALYST_API_CLIENT_ID/SECRET from server/.env; /api/scheduled-jobs,
  /api/subscriptions.
- Go dispatcher sends `X-Event-Type` (NOT x-fc-event-type); fulfil's process
  routes need the same tolerance when it moves to the Go platform.
- Worker env gates: FC_SCHEDULED_JOB_ENABLED / FC_STREAM_PROCESSOR_ENABLED /
  FC_SCHEDULER_ENABLED / FC_ROUTER_ENABLED (fc-dev defaults true; envs
  override silently).
- fulfil-go smoke pattern: run a throwaway server on :3299 against the same
  DB (never kill the user's :3200 tsx-watch; kill by port when done).
