# fulfil-go — handoff / pickup state

Last updated: 2026-07-13 (transport-planning + management-chrome session).
Everything below is COMMITTED on `main`. Read `CLAUDE.md` first (stack,
conventions, gotchas, dev loop); this file is "where we are + what's next".
**NEXT SESSION (Andrew, 2026-07-13): INDEX PASS — review access patterns
and plan an optimal index set balancing write vs query performance**
("Agreed next steps" item 1 below has the access-pattern map). After
that: driver status-report API + delete the jobs vertical, or the
fulfilment completion leg.
Product decision 2026-07-13: fulfil-go has NO iOS APP — picking stations
are Android or browser; don't build/maintain ios/ projects. SISTER REPO:
InhanceMono has branch `feature/fulfilgo-epod-integration` (worktree
~/Developer/inhance/InhanceMono-fulfilgo-epod, 4 commits, NOT pushed) —
the EPOD-side endpoints + claim proxy; rebase onto fresh origin/develop
before pushing.

## What landed 2026-07-13 (transport-planning + management-chrome session)

**Transport PLANNING context** (docs/transport-context.md status header has
the full summary):

- Trip aggregate (`trp_`, `domain/trips/`): offered → claimed | expired |
  released; driver+vehicle+depot bound at OFFER time; stops = VROOM-ordered
  dropoffs with leg estimates. Trips ARE the reservation record; member
  orders carry an expiring `reservation` jsonb hold (expiry frees
  implicitly — NO sweeper; readers treat a lapsed hold as free).
- Offer composition (`transport/planning/offer-composition.ts`, unit-
  tested): anchor claims resolve part SHORT ID → fulfilment externalRef
  (never substitute — empty offer with reason); hot parcels never
  consolidate; companions same-store + windows overlap ±30min + drop
  within 5km of the seed's; caps from NEW store settings maxStopsPerTrip
  (3) / maxBagsPerTrip (12) + allocationStrategy ('claim' — the port for
  future 'assign'); VROOM `solve` via the LIVE router, slot-order fallback.
- ONE marketplace, two doors (api/routes/transport):
  `/clients/:id/transport/epod/claimable-trips` + `/claims/:groupId`
  (exact contract of Integral's `FulfilGoClaimClient` proxy) and
  `/clients/:id/transport/offers` + `/offers/:groupId/claim` (execution
  app, driver = principal). Claim on 'epod' builds the route plan
  (`transport/epod/route-plan-mapper.ts` — typed `EpodRoutePlan`
  mirroring their `FulfilGoRoutePlansSyncTest` payload; items from part
  lines + PICKED quantities; store NEVER embedded in masterdata) and
  pushes it SYNCHRONOUSLY via EpodClient; failure releases the whole
  group → 410 (driver sees offer-expired). Orders → `assigned` on claim
  (booked+assigned collapse; providerRef = trip id; courier = driver ref +
  vehicle reg). Idempotent re-claim replays the success response.
- Events `fulfil-go:transport:trip:{offered,claimed,released}` registered +
  schemas pushed (`pnpm flowcatalyst:sync` RUN this session). Migration
  `20260713104149_trips_and_reservations` applied to the dev db.
- Smoke-verified on :3299 (mock EPOD intake on :3298 + LIVE router VROOM):
  solo + multi-stop offers, anchor + anchor-held reasons, expiry release,
  422-rejection release, idempotent re-claim, wrong-driver/unknown 410s,
  native own-channel claim (no plan push). Smoke rows remain on the dev db
  (trips trp_0QZSB*/trp_0QZSC*, synthetic orders tro_0QZSMK000000{1,2,3}) —
  `purge:dev-data` clears them.
- EPOD offer→store mapping: the store's 'epod' transportProviders entry
  config carries `{depotReference, territoryReference?, companyReference?,
companyName?, transporterReference?, vehicleTypeReference?}` (API-set;
  dev data: dark-store profile → SMOKE-DEPOT-1). vehicleType defaults to a
  self-provisioned FULFILGO-VAN — point `vehicleTypeReference` at a REAL
  EPOD type per store if retyping their vehicle on plan ingest matters.

**Management chrome** (Andrew's mid-session batch):

- Web OIDC sign-in/out: mobile-kit gained the `auth-web` subpath
  (PKCE pair + token session + localStorage store) and the api client now
  falls back to dev headers only while SIGNED OUT; management app got
  `src/auth/session.ts`, `/login/callback` (NOT under /auth — that prefix
  is dev-proxied), and Sign in/Sign out in the profile popover. NOTE: the
  platform's "Fulfil Go Login" OAuth client had NO redirect for the SPA —
  registered `http://localhost:5177/login/callback` by DIRECT INSERT into
  fc-dev's `oauth_client_redirect_uris` (oac_6FME1MN9PH83B). Do this
  properly (platform UI/API) for real environments. Full round trip
  verified up to the IdP login redirect (307) — the interactive login is
  the remaining manual check.
- GET /auth/clients (server) → platform client registry via a service-
  account `FlowCatalystClient` (new `appContext.platform`; 60s cache;
  v1 = every ACTIVE client — move to the platform's user-scoped
  /api/me/clients when management runs fully on user tokens). Profile
  popover switches clients by NAME (falls back to raw-id input when the
  platform is down).
- Flightboard store filter: "Select all (N)" + "Clear all" buttons.
- `pnpm --filter @fulfil-go/server purge:dev-data [-- --client clt_X]` —
  clears operational data (fulfilments/picks/transport/trips/logs/queues/
  short-id counters), keeps reference data; refuses non-local DATABASE_URL
  without --force; --client skips client-blind tables (sync_events, jobs,
  telemetry, outbox, audit, idempotency).

## What landed 2026-07-13 (bag-label-printing session)

**Printer registry + bag-label printing** (docs/bag-label-printing.md — the
design doc; read it before touching the replace flow):

- `printers` table (store-bound reference data, `prt_` ids) + repository +
  `/clients/:id/printers` CRUD (ManageStores; GET also answers picker
  sessions scoped to their store). Management app: Stores → Printers page.
- Pick aggregate gained `labels` jsonb (`PickLabelAllocation`): PUT
  `/picks/:id/labels {count, printerId?}` allocates/replaces/re-renders,
  POST `/labels/:seq/reprint` reprints one. **Refs (`pkg_` TSIDs) are STABLE
  per (pick, seq)** — replace keeps kept seqs' refs, voids dropped ones —
  that's the invariant keeping the WIP trolley consistent. Domain event
  `fulfil-go:pick:pick:labels-updated` + activity-log `label-print` entries
  (allocate/replace/reprint). ZPL rendered server-side
  (domain/picks/label-zpl.ts), sized from the printer's dpi/label-mm.
- Picking app: Settings gained station printer binding
  (`fulfilgo.pick.station.printerId`, list scoped by picker session);
  PACK stage gained the Bag labels card (count stepper, print/replace,
  per-label reprint chips, trolley guard: can't shrink below a scanned
  bag). Scanning a printed label into the drawer shows its `n / X`; voided
  refs are rejected. Delivery: IN-REPO `TcpPrint` Capacitor plugin (raw TCP
  :9100, ANDROID-ONLY Java — no iOS app, Andrew 2026-07-13; deliberately
  not a third-party npm socket plugin); browser dev delivers via Zebra
  Browser Print's local agent (plain fetch, no SDK). Completion payload
  unchanged — labels just fill `packages[].ref`; arbitrary barcodes and
  `loose-N` still work (stores without printers).
- Smoke-verified end-to-end on :3299 (17 checks: CRUD guards, allocate 3 →
  reprint → replace 4 → replace 2 with voiding, recovery GET, wrong-store
  printer 404, completion with label refs). Migration
  `20260713093811_printers_and_pick_labels` applied to the dev db.
- NOT verified (device-only): TcpPrint on real Android hardware against a
  real Zebra on a store LAN.
- `pnpm flowcatalyst:sync` now ALSO registers `pick:labels-updated`
  (8 events already queued in the dev outbox from the smoke).

## What landed 2026-07-13 (transport session, 5 commits)

1. **Activity log** (`aff6892`): fulfilment_processing_log generalized into
   `activity_log` — subject (fulfilment/part/pick/transport_order/trip) +
   source (domain/platform/uber/epod/admin) on every entry, fulfilment_id
   as root correlation. Same-tx `append` for domain writes, best-effort
   `appendDetached` for external interactions, `hasEntry` stays the PM
   dispatch guard. Webhook deliveries ACKed-without-action are recorded
   (source=platform, category=webhook). API renamed to
   `/fulfilments/:id/activity-log`.
2. **Process registry v1** (`cdfb66a`, docs/process-definitions.md):
   `fulfilments.process_definition` ownership stamp (default 'standard')
   resolved at creation from the new `client_settings` table (GET/PUT
   `/clients/:id/config/client-settings`, registry-validated).
   `src/processes/`: registry (stamp → definition; unknown stamp = 500,
   deploy error) + the standard definition — the /processes/fulfilment
   switch reshaped into a thin policy module; the route is now shared
   infrastructure. DSL/diagrams deferred until N≥2.
3. **Management chrome fixes** (`e3e323a`): GET /auth/me (name/email from
   OIDC claims; dev fallback honours x-user-name via mobile-kit's
   devUserName / VITE_DEV_USER_NAME); SidebarProfile shows the real
   identity; content panes left-aligned (mx-auto dropped).
4. **Config reshape** (`588944c`, Andrew's mid-session direction):
   - 'hot' temperature class chain-wide (products + packages; packing
     drawer has a Hot square; generator fixtures ~5% hot items).
   - pickSortAlgorithm 'temperature-zone': ambient → chilled → frozen →
     hot, walk-sequence WITHIN each band.
   - **Store profiles SPLIT by owning domain**: store*profiles.domain
     ('pick'|'transport'), stores carry pick*/transport\_ profile codes +
     per-domain override columns. Config API is
     `/clients/:id/config/:domain/store-profiles`; management pages live
     under Picking → Pick profiles and Transport → Transport profiles.
     Transport profile owns defaultExecutionSystem + executionSystems
     (alternatives, both now editable), transportLeadTimeMinutes (default
     45), defaultTransportProvider + transportProviders allowed[] entries
     ({code, serviceRadiusKm?, config?} — API-set, no UI).
   - stores gained lat/lng columns (extracted from the captured record).
5. **Transport context — demand side** (`9775e96`,
   docs/transport-context.md): TransportOrder aggregate (tro*, one per
   picked part, forward-only machine requested → booked → assigned →
   collected → delivered|failed|cancelled) + fulfil-go:transport:order:\*
   events; provider registry ('own'/'epod' = OUR-PLANNED → orders stay
   requested for the planning marketplace; 'uber' = provider-planned,
   registers when FULFILGO_UBER*\* creds set); resolver = transport profile
   allowed[] ∩ registry ∩ vehicle capability ∩ radius coverage (haversine
   v1 on store lat/lng — same oracle seam for future PostGIS/pinpoint
   polygons), store default ranked first, remainder = fallback chain.
   Trigger: standard definition on its own fulfilment:picked (payload now
   carries serviceLevel/slotStart) — ASAP requests immediately, STANDARD
   books a `process_reactions` row due slotStart − transportLeadTime,
   released by the fulfil-go-transport-reactions cron →
   /jobs/run-transport-reactions. Booking: dispatch job → HMAC landing pad
   /clients/:id/transport/orders/:id/book walks the chain OUTSIDE any tx
   (uber 4xx = next candidate, 5xx = platform retry), then one short tx
   books/fails. Uber webhook /transport/webhooks/uber (raw-body signature;
   FULFILGO_UBER_WEBHOOK_SECRET) → apply-transport-status (stale ACKed).
   GET /clients/:id/transport/orders for management.

## ⚠️ Operational to-dos before the platform loop covers transport

- Router creds LIVE (2026-07-13, second set from Andrew: prn_6F8EC3HVN302N
  in server/.env) — token minted at platform.inhanceapps.com, /v1/route/
  simple and /v1/solve verified against production. VROOM is ready for the
  planning context.
- Vehicle map tiles: Andrew will expose the tile stack via the router and
  share the style URL — set VITE_MAP_STYLE_URL then (MapLibre demo style
  is the interim fallback).
- Planning v1 capacity decision (Andrew): SIMPLE CAPS ONLY — store-settings
  maxStopsPerTrip/maxBagsPerTrip, NO vehicle registry yet; EPOD
  vehicleRegistration carried but not capacity-checked.

- ~~Run `pnpm flowcatalyst:sync`~~ RUN 2026-07-13 (planning session):
  everything registered incl. transport:trip:\* (26 event types, schemas
  pushed). Re-run after any new event/subscription work as usual.
- Set per-store transport profiles: the smoke left the CLIENT-WIDE
  'default' transport profile with transportProviders [own, uber(15km)] +
  defaultTransportProvider 'own' on clt_6F9GM54BB5G2Y (dev data).
- Smoke data: ful_0QZ26YJKR0E34 + ful_0QYSMFFFQ4RZB now have transport
  orders (status requested, provider 'own') on the dev db.

## Contexts & status

| Context         | State                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fulfilment      | create/cancel/release + PM reactions + READY/FAILED derivations + transport trigger (ASAP/STANDARD). Missing: completion leg (consume transport delivered/failed → completing → completed/partially_completed), cancel-while-picking. |
| Pick            | Full vertical incl. bag-label printing (n/X pre-allocated refs, reprint, replace). Missing: pick-into-bag-directly mode, approved-substitute lists.                                                                                   |
| Picker identity | PIN-primary complete. Missing: QR badges, device enrollment, break-glass.                                                                                                                                                             |
| Stores          | Base registry + geo columns + per-domain profile assignment.                                                                                                                                                                          |
| Transport       | DEMAND SIDE LIVE (orders, resolver, trigger, uber booking/webhook). Missing: management Transport orders page (API exists), EPOD status flow BACK (their workflow/stop webhooks → order machine).                                     |
| Planning        | LIVE — Trip aggregate + group-atomic reservations + offer/claim marketplace (EPOD proxy door + native door), VROOM sequencing, sync route-plan push. Missing: execution-app consumption, real-EPOD-tenant verification.               |
| Jobs (demo)     | Throwaway vertical; still powers execution-app. SUPERSEDED — the claim marketplace is live server-side; migrate execution-app onto /transport/offers and delete the vertical.                                                         |

## Agreed next steps (priority order)

1. **INDEX PASS (Andrew, 2026-07-13)**: review access patterns across the
   schema and design an index set balancing WRITE cost (every aggregate
   persist is an optimistic-locked UPDATE; outbox/sync/activity append on
   every commit) against the hot reads. Access-pattern map to work from:
   - WRITE-HEAVY, keep lean: `outbox_messages` (append + poller drain
     scan by status), `sync_events` (append + broker poll with the
     visibility-horizon predicate `txid < pg_snapshot_xmin(...)` +
     channel/id cursor — check the poll plan!), `activity_log` (append;
     read only per-fulfilment timeline), `audit_logs`, `idempotency_keys`
     (PK hit), `telemetry_locations` (batch insert).
   - HOT READS to EXPLAIN against realistic volume (generator can make
     thousands): flightboard-query (fulfilment_parts by client+status+
     store + SLA time predicates), `picks` store-channel lists
     (client+store+status) + pick_sessions projection reads,
     transport marketplace feed `listRequestedByStore` (client+origin+
     status='requested'+provider IN — existing idx_transport_orders_
     store_status lacks provider), trips listByClient (client+status+
     created_at DESC — index exists but not covering the sort),
     `fulfilments.listDueParts` (release sweep: status+release_at across
     clients — check it isn't a seq scan), depot_stores lookups (both
     directions — indexed), driver/picker login (unique index = covered),
     process_reactions due sweep (status+due_at — indexed).
   - Balance questions: jsonb columns queried by expression? (none yet —
     keep it that way or add expression indexes deliberately); partial
     indexes for status='requested'/'pending' hot subsets vs full
     composites; whether flightboard needs the projections planned in
     docs/projections.md instead of more indexes on the write tables.
   - Method: seed a big dataset with the generator, `EXPLAIN (ANALYZE,
     BUFFERS)` each query-module SQL + repo read, check pg_stat_user_
     indexes for dead weight afterwards. Embedded PG has no
     pg_stat_statements by default — drive the known query list instead.
2. **Execution-app migration onto the claim marketplace**: consume
   `/clients/:id/transport/offers` + `/offers/:groupId/claim` natively
   (offer card with the stop sequence, claim → drive → per-stop
   delivered/failed reporting — which needs the status-report API below),
   then DELETE the demo jobs vertical (routes, aggregate, use cases,
   execution-app pages). ~~Build the planning context~~ BUILT this
   session — server-side marketplace is live and smoke-verified.
   Companion pieces:
   - ~~Driver identity~~ **BUILT 2026-07-13 (same session)** — PICKER-STYLE
     per Andrew's decisions: staff code + PIN ONLY (no device pinning —
     device enrollment is the shared phase-2 story; the token's deviceId
     claim is the seam). `domain/driver-identity/` +
     `/driver-auth/{login/pin,refresh,me}` + `/clients/:id/drivers`
     CRUD/seed (ManageDrivers — dispatcher role, synced) + management
     Drivers page. Driver tokens ride the picker token machinery, issuer
     `fulfilgo-drive`; scope carries clientId/depotRef/driverRef.
   - **DEPOTS are independent of stores (Andrew, same session — no 1:1)**:
     `depots` + `depot_stores` registries (M:N — one depot serves many
     stores; a dark store with own drivers = a depot serving one store).
     Drivers bind to `depot_ref` (login is depot+code+PIN); the offer feed
     spans EVERY store the depot serves (companions still single-origin
     per trip; the seed order picks the trip's store, caps resolve from
     it). EPOD claimable-trips `depotReference` resolves through this
     registry now (set depot refs = EPOD's for adopted clients) — the old
     provider-entry-config depot mapping is GONE. Management: Transport →
     Depots page (create/edit/link stores/delete-guarded/seed-per-city).
     `POST /clients/:id/depots/seed` = one depot per store CITY (dev).
   - **Vehicle classes + unit sizes (Andrew, same session)** — CLIENT
     SETTINGS (`vehicleClasses: [{code,name,maxUnits,maxMassKg?}]`,
     `packageUnitSizes: {XS:1,S:2,M:3,L:4,XL:6}` defaults): offer
     composition caps a trip's total UNITS (parcel bag size → units) by
     the driver's vehicle class; maxMassKg is carried but NOT enforced
     (parcel mass isn't captured yet). Drivers carry defaultVehicleClass
     (walked bike/car/van by the seeder). API-set via PUT
     /config/client-settings (dev db configured: bike 8 / car 24 / van 60
     units); no dedicated settings UI yet.
     Dev db reseeded: 11 city depots covering 100 stores, 33 drivers
     (3/depot, PIN 374837). Smoke-verified LIVE: depot login → me (depot +
     class) → bodyless /transport/offers composed a real offer from the
     depot's 8 Bloemfontein stores (order #1001 at store-001).
     ~~REMAINING: the execution app's login screen + offer/claim UI~~
     BUILT (same session): the execution app now has the DRIVER PLANE —
     Settings gained the device→depot binding (clientId + depotRef,
     localStorage `fulfilgo.exec.station.*` — the picking app's station
     pattern), `/driver-login` (staff code + PIN via mobile-kit's new
     `driverPinLogin`; `createPickerSession` gained `authBasePath` so one
     session machinery serves both planes), and a **Work tab** (`/offers`,
     now the default route): Find work (optional anchor part number) →
     reserved offer card with stop sequence + 30s countdown → Claim / Pass
     → claimed-trip summary. Auth priority: driver session wins over
     platform OIDC; browser dev falls back to x-user-id when signed out.
     Driver shift survives app restarts (bootstrap restores from the
     persisted refresh token). Execution-app vite proxy gained '/clients'
     (the known gotcha) — RESTART the :5175 dev server to pick it up.
     REMAINING: per-stop collected/delivered/failed reporting (needs the
     driver status-report API), then DELETE the demo jobs vertical.
   - A driver status-report surface for 'own' trips (collected/delivered/
     failed per stop → apply-transport-status), since own-channel
     execution has no webhook source.
3. EPOD status flow BACK: their workflow/stop webhooks → epod adapter
   normalizes (string references only) → TransportOrder machine — plus
   real-EPOD-tenant verification of the claim proxy + sync plan intake
   (their branch is still unpushed).
4. Fulfilment completion leg: subscription gains transport:order:delivered/
   failed/cancelled → PM: ready → completing → completed/partially_completed
   (+ commerce hook seam per docs/process-definitions.md layer 2).
5. Management Transport orders page (list API already live) + flightboard
   delivery KPIs (transport exception kinds reserved).
6. Pick-into-bag-directly mode; picker auth phase 2 (QR/enrollment).
7. ~~Printer management + bag-label printing~~ BUILT 2026-07-13 (see
   above + docs/bag-label-printing.md). Remaining: device verification of
   TcpPrint (Android) against a real Zebra on a store LAN.

## Known issues / loose ends (not fulfil-go blockers)

- **pinpoint shares the pool-self-deadlock pattern** (bare `db.` reads inside
  runWrite) — MUST sweep before its prod cutover (see CLAUDE.md gotcha).
- pinpoint `test/auth/session-refresh.test.ts`: 2 pre-existing failures.
- `fc-dev outbox` pollers accumulate AND die silently (bit us 2026-07-13:
  a days-old poller stopped ingesting mid-session — flightboard showed
  work, no picks materialized). Signature: outbox_messages rows pile up
  while platform msg_events stops advancing. Kill stale pollers (check
  process start dates) and restart standalone:
  `fc-dev outbox --source-db-url postgresql://postgres:postgres@localhost:15432/fulfilgo --target-url http://localhost:8080 --client-id $FLOWCATALYST_API_CLIENT_ID --client-secret $FLOWCATALYST_API_CLIENT_SECRET`
  (also saved to workspace memory).
- Platform observations flagged to Andrew: dataOnly payloads double-encoded;
  5-field crons validate but never fire; scheduled-job client-scope
  migration strands platform-scoped duplicates.
- TypeScript 7: repo stays on TS6 until 7.1 (vue-tsc needs the new API).
- Historical activity_log rows (pre-split) carry subject_type='fulfilment'
  for pick entries — migrated as-is by design; new writes carry pick/part.
- EPOD integration detail: docs/epod-integration-notes.md (their side) +
  transport-context.md "EPOD adapter (fulfil-go side)". Constraints stand:
  origin.ref == EPOD location reference; our client code == EPOD tenant
  code; map statuses only on string references.
- Projections (docs/projections.md): pick_sessions LIVE; NEXT
  fulfilment_sessions + transport_sessions + Stats page.
- Fulfilments page could render captured part ACTUALS (already on the DTO).
- Offered, not built: management "Products" reference page.

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
- Drizzle-kit 1.0 prompts on ambiguous diffs and needs a TTY — answer via
  `expect` (see scratchpad gen.exp pattern) or split schema changes into
  unambiguous phases (add-only → drop-only) and hand-edit the data copy
  into migration.sql.
