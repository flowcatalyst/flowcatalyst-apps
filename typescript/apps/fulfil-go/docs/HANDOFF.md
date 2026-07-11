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

| Context | State |
|---|---|
| Fulfilment | create/cancel/release + PM first slice (pick reactions, ready/failed derivation). Missing: transport request on ready, handover, completion, cancel-while-picking (`cancelling`). |
| Pick | Full: intake, claim, pick-then-pack, substitutes (captured-as-scanned), outcomes, packages, requiresVehicle. Missing: pick-into-bag-directly mode (needs pick_lines as ROWS — see picking-workflow.md), approved-substitute lists (master-data gateway). |
| Picker identity | PIN-primary complete (login/refresh/lifecycle/seeding, dev PIN 385345). Missing: QR badges, device enrollment, break-glass (pick-context-auth-plan.md phases). |
| Stores | Base registry section (sync from fixtures). Real master-data sync later; transport config per store later. |
| Transport | NOT BUILT — design in transport-context.md (TransportOrder + provider port 'own'/'uber'). All inputs already captured on fulfilment parts. |
| Jobs (demo) | Throwaway vertical; still powers execution-app. Candidate backend for the 'own' transport adapter — DECIDE before transport build (vs fulfil's last-mile). |

## Agreed next steps (priority order per Andrew's direction)

1. **Transport context** (the big one): TransportOrder aggregate, provider
   port ('own' driver execution for ROA stores, 'uber' Direct), store/client
   provider config, PM requests transport on READY (ASAP immediate,
   STANDARD timed via reaction bookkeeping + deadline sweep). Open decision:
   'own' adapter backend = execution-app jobs vs fulfil last-mile.
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
- Fulfilments page could render the captured part ACTUALS (line_results/
  packages/requiresVehicle are already on the DTO) — small UI win.
- Offered, not built: management "Products" reference page (sku/gtin lookup
  + rendered barcodes for scan testing).

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
