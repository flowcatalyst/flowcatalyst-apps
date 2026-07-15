# fulfil-go — handoff / pickup state

Last updated: 2026-07-15 (EIGHT features across 13–15 Jul, all COMMITTED
on main — as WIP-titled commits c283031/45aeba2/b684a69/50a8e4; consider
squash-labelling before pushing anywhere shared): index pass,
loose-barcode + Add-package drawer, HANDOVER VERIFICATION (pins, age
checks, deferred verification), requiresCarOrLarger rename + pick
SUPERVISOR role + day-scoped stations, BAG SIZING (specs catalog,
construction, loose auto-size), ONE ACTIVE TRIP per driver, and the
GUIDED DELIVERY JOURNEY (navigate/arrived/proof none|pin|picture + the
framework BlobStore port, db/S3 drivers), plus SIGNATURE proof +
government-ID photo + management list filters (15 Jul). 15 Jul also:
DEMO JOBS VERTICAL DELETED + the FULFILMENT COMPLETION LEG BUILT (see
below). Read `CLAUDE.md`
first; the "What landed" blocks below are newest-first.
**NEXT: the EPOD status flow back, the trip TOP-UP (Add-to-Route), or
offline-queue the driver report calls**.
Device/deploy-only verifications outstanding: native camera capture +
barcode scanning on real Android, TcpPrint vs a real Zebra, the S3 blob
driver against a real bucket.
Product decision 2026-07-13: fulfil-go has NO iOS APP — picking stations
are Android or browser; don't build/maintain ios/ projects. SISTER REPO:
InhanceMono has branch `feature/fulfilgo-epod-integration` (worktree
~/Developer/inhance/InhanceMono-fulfilgo-epod, 4 commits, NOT pushed) —
the EPOD-side endpoints + claim proxy; rebase onto fresh origin/develop
before pushing.

## What landed 2026-07-15 (FULFILMENT COMPLETION LEG, same session)

**COMPLETION LEG BUILT** (agreed next-steps item 6; docs/fulfilment-context.md
state sketch is now fully implemented for the delivery leg):

- Subscription `fulfil-go-fulfilment-process` gained the transport-order
  terminals (delivered/failed/cancelled) → standard definition →
  `RegisterPartDeliveryUseCase` (operations/fulfilment-transport-process):
  part picked|short_picked → completed|failed (one version bump), then the
  derivation — outcomes outstanding → fulfilment COMPLETING, all in-play
  parts terminal → COMPLETED (all delivered) / PARTIALLY_COMPLETED (mixed —
  pick-failed siblings count) / FAILED (nothing delivered). markCompletion
  composes with the part transition (no second bump — house rule).
- New events (registered + schemas pushed, `flowcatalyst:sync` RUN):
  `fulfil-go:fulfilment:part:delivered`, `part:delivery-failed`,
  `fulfilment:completed`, `fulfilment:partially-completed`; the all-failed
  terminal reuses `fulfilment:failed`. Activity log: part `delivery`
  entries + fulfilment `lifecycle` terminal entry.
- Replays/out-of-order ACK via the existing state guards
  (FULFILMENT_NOT_AWAITING_DELIVERY / PART_TRANSITION_ALREADY_APPLIED).
- Tests: 260 green (8 new — transition + full derivation matrix).
- SMOKE-VERIFIED through the LIVE platform loop, twice: leftover claimed
  trips from earlier sessions finished for real on :3299 — D01 delivered
  tro_0QZWBMY2ZQ2WE → order:delivered → outbox → poller → platform →
  :3200 decider → ful_0QZT1CNVNFS95 `ready → completed` (+
  fulfilment:completed projected AND fanned on the platform); D01 failed
  tro_0R0388TY2B6VT ('customer not home') → ful_0R03872K2M4Y1 `ready →
  failed`. PARTIALLY_COMPLETED path is unit-tested only (no multi-part
  live scenario staged) — worth a look when one arises naturally.

## What landed 2026-07-15 (demo jobs vertical DELETED)

**DEMO JOBS VERTICAL DELETED** (agreed next-steps item 4's remaining piece):

- Server: `/jobs` routes, Job aggregate + events + repository + the four
  use cases, `jobs` schema/table (migration `20260715091943_drop_demo_jobs`,
  applied to the dev db), `GET /sync/jobs` (the picks snapshot route stays),
  app-context wiring, swagger tag. Shared: JobDto, job contracts, job domain
  schema, `job.*` SyncEventTypes + DeltaSyncResponse, the four job
  permissions (Dispatcher/FieldWorker role bundles slimmed — roles re-synced
  to the platform via `pnpm flowcatalyst:sync`, 4 updated). Job events were
  never platform-registered, so nothing to unregister.
- Execution app: Jobs/JobDetail pages + jobs store + routes gone; post-login
  lands on `/offers`. SSE stays wired (header badge + the seam where trip.*
  events will land) — NOTE: nothing publishes to the driver's `user:` channel
  right now; per-principal SSE consumers start from `ctx.sseState`.
- CLAUDE.md dev-loop rewritten around the driver claim-marketplace flow;
  transport-context.md open question resolved (Work tab IS the 'own' door).
- Verified: all fulfil-go packages build; server 252 + mobile-kit 20 tests
  green; live smoke on :3299 — `/jobs` + `/sync/jobs` 404, driver PIN login →
  `/driver-auth/me` → offer composition → SSE channel all 200, picks sync
  guard intact (403 for non-picker sessions).

## What landed 2026-07-15 (signature + ID-photo + filters session)

**SIGNATURE PROOF + GOVERNMENT-ID PHOTO + LIST FILTERS** (smoke 9/9;
docs/handover-verification.md "Signature proof + government-ID photo"):

- `deliveryProof` gained `'signature'` end-to-end: canvas signature pad in
  the delivery drawer → PNG → blob store (`sig_…`), `signatureRef` on the
  evidence; missing signature = accepted + flagged. Stops badge ✍️.
- `ageIdPhotoRequired` (client fulfilment settings, DEFAULT OFF — POPIA):
  restricted deliveries on the id-attestation path must photograph the
  government ID (`id_…` blob, `ageCheck.idPhotoRef`); missing = flagged
  'government-ID photo missing'. Camera reused via a capture-target seam.
- Blob refs now `(pod|sig|id)_…` on the same pod-photos endpoints.
- Management Fulfilments page: server-side FILTERS — status (multi),
  type, slotStart range (rides idx_fulfilments_client_slot) — filter bar
  + `status`/`type`/`slotFrom`/`slotTo` query params on the list API.

## What landed 2026-07-14 (guided delivery journey, same session)

**GUIDED DELIVERY JOURNEY BUILT** (docs/handover-verification.md
"Guided delivery journey" — smoke 10/10):

- `deliveryProof: none|pin|picture` on client fulfilment settings
  (default 'pin'; legacy deliveryPinEnabled maps) → stamped policy →
  order requirements (`requiredDeliveryProof` normalizes old rows) →
  my-trips → the app's delivery drawer ADAPTS (pin block / camera block /
  straight-through). Pins generate only for mode 'pin'.
- **BlobStore port in @fulfil-go/framework** + config-selected drivers
  (`FULFILGO_BLOB_STORE=db` default → new `blobs` table, migration
  `20260714211926_blobs`; `s3://bucket/prefix` → lazy @aws-sdk/client-s3,
  now a runtime dep). Client-scoped. POD photos: client-generated
  `pod_…` refs, idempotent PUT (queued before the report offline — FIFO),
  GET serves the image.
- Evidence gained `photoRef` + `arrivedAt`; missing photo on picture-proof
  = accepted + flagged (verification entry + flightboard exception).
- Execution app: stops now run as a GUIDED SEQUENCE (active stop only):
  🧭 Navigate (geo: intent native / Google Maps browser) → 📍 I've arrived
  (persisted local overlay → evidence) → proof drawer → next stop unlocks;
  trip:completed unchanged. @capacitor/camera added (native capture;
  browser uses file input + canvas compression).
- NOT verified: S3 driver against a real bucket; native camera on device.

## What landed 2026-07-14 (one-active-trip rule, same session)

**ONE ACTIVE TRIP per driver (Andrew, 2026-07-14 — industry norm: stacking
is PLANNER-composed into one route, never driver-initiated):** own-channel
compose refuses (`reason: OPEN_TRIP_EXISTS`) and claim 409s while the
driver holds a claimed trip; EPOD's door is EXEMPT (their system manages
driver workload). Execution app hides Find work with an open trip
("Finish your current trip to claim more work."). Smoke 5/5 live (claim →
compose refused → crafted second offer claim 409 → finish → unblocked).
CONSOLIDATION of two un-started trips is UNREACHABLE under this rule —
the follow-up shape is a TOP-UP instead (extend a claimed, un-collected
trip with more offerable orders at the same store within caps — the
DoorDash "Add to Route" pattern); queued in next steps, not built.

## What landed 2026-07-14 (bag-sizing build, same session)

**BAG SIZING BUILT** (docs/bag-sizing.md — status header has the 15/15
LIVE-loop smoke; next-steps item 3 below is DONE):

- Shared: `BagSpecsSchema` (per size code: dims mm + maxMassKg? + units) —
  `client_settings.bagSpecs` ABSORBS packageUnitSizes (legacy input still
  honoured as a units overlay; resolved packageUnitSizes DERIVES from
  bagSpecs so composition math can't drift); pick store profiles overlay
  per size + `constructionByTemperature`; `PackageConstructionSchema`
  standard|insulated|insulated-gel; `fitBagSize` (rotation-allowed
  smallest-fit). Tote-anchored defaults (M 400×300×250).
- Pick: completion STAMPS construction (picker choice, else derived from
  the bag's temperature square) + dims (bag → store catalog; loose → the
  matched line's volumetrics, since loose refs are the item's barcode)
  onto packages — captured, retunes never rewrite. New picker-session
  `GET /pick-station-settings` feeds the station. events pick:picked/
  short-picked packages now carry construction+dims (schemas re-pushed at
  next sync — RUN `pnpm flowcatalyst:sync`).
- Picking app: "Bag type" squares pre-derived from the temperature square
  (tap to stick); loose AUTO-SIZE chip from product dims (asks only when
  no dims/no line match; oversize → XL); soft OVERSIZE SANITY CHECK in
  the completion drawer (item bigger than the largest declared bag with
  no loose, or total volume overflow >20% slack) — advisory, never
  blocking (bags-only mode can't verify contents; Andrew).
- Transport: parcels carry construction+dims (part actuals pass through);
  uber bookings apply a per-client `sizeMap` override from the store's
  provider entry config (`{code:'uber', config:{sizeMap:{M:'large'}}}`),
  junk values fall back to the static map; REAL dims to uber DEFERRED
  (their manifest requires weight alongside — parcel mass not captured).
  Loose size-equivalents now count REAL units in offer composition
  (fixes the size:null=1-unit undercount).
- Tests 126 green (bag-specs resolution/fit + uber sizeMap added); all
  apps build; smoke 15/15 through the live release-cron→dispatch→PM loop.

## What landed 2026-07-14 (supervisor car-flag + day-scoped picks, same session)

**RENAME (Andrew: clear language — a scooter IS a vehicle):**
`requiresVehicle` → **`requiresCarOrLarger`** across the ENTIRE chain — 35
files, 4 column renames (migration `20260714083647_car_or_larger_rename`,
generated via the expect rename-prompt pattern), event payloads (schemas
re-pushed), docs. Pick app question copy: "Does this need a car or bigger?
Too big/heavy for a bike or scooter."

**PICK SUPERVISOR ROLE + CAR FLAG** (Andrew, 2026-07-14):

- `picker_users.role` ('picker'|'supervisor'; migration
  `20260714084859_picker_role`); supervisor PIN login (same flow) mints the
  extra `supervisePicks` session permission (re-resolved on refresh —
  promotion/demotion bites ≤1 TTL). Seeder makes P01 the store supervisor
  (dev db: existing P01s promoted via SQL); Pickers page shows the badge.
- `POST /picks/:id/car-flag {requiresCarOrLarger}` (SupervisePicks +
  store binding, 404 anti-enumeration): sets the flag ANYTIME the pick
  isn't failed; activity `vehicle-flag` entry + `pick.updated` store-channel
  SSE + `pick:car-flag-updated` domain event (registered + synced).
- MERGE RULE (unit-tested): a supervisor 'true' SURVIVES the picker's
  completion answer (Pick.complete ORs it); the station's completion
  question renders LOCKED ("🚗 Car or bigger — flagged") when pre-flagged.
- POST-COMPLETION propagation: standard definition handles
  car-flag-updated → RegisterPartCarFlagUseCase re-stamps the PART while
  no transport order exists (`fulfilment:part:car-flagged` event); once
  transport is requested it's TOO LATE — ACKed + activity-logged for ops.
  SMOKE-VERIFIED through the LIVE platform loop: flag on :3299 → outbox →
  poller → platform → :3200 decider re-stamped the part.
- Picking app: supervisor sessions (ctx.supervisor from /me permissions)
  get a 🚗 toggle on Available/Handover cards; 🚗 CAR+ badge shows for
  everyone (SSE pick.updated reconciles instantly).

**PICK APP DAY-SCOPING + RETENTION** (Andrew, 2026-07-14): stations show
ONLY the local day's picks (available/mine by slotStart; handover by
completedAt) — never history. `/sync/picks` snapshot is bounded server-side
to slotStart ±36h (listByStore gained an optional window); the device
prunes >30-day picks + orphaned `fulfilgo.pick.wip.*` entries on every
hydrate. Smoke: 9 checks (supervisor grant, flag + refusal for P02 +
replay 409, snapshot window).

## What landed 2026-07-14 (handover-verification build session)

**HANDOVER VERIFICATION BUILT** (docs/handover-verification.md — status
header has the smoke summary; next-steps item 2 below is DONE):

- Shared: `client_settings.fulfilment` section (pickup/delivery pin
  enablement, deliveryPinSource random|phone-last4, ageVisualOverrideAllowed;
  section-merged in resolveClientSettings), `FulfilmentLine.restrictedMinAge`
  (first-class process input), `HandoverPolicySchema`, `viewHandoverPins`
  permission (Dispatcher role; roles re-synced to the platform).
- Fulfilment: policy STAMP + `deliveryPin` (root) + `pickupPin` (per part) +
  `maxRestrictedAge` generated at creation (migration
  `20260714063438_handover_pins`); pins ride the CREATE RESPONSE
  (`handover` block) + the audited GET
  `/fulfilments/:id/handover-pins` (audit-BEFORE-disclose via new
  `activityLog.appendAudited`; management grant = full pins, picker session
  grant = own store's pickup pins only) — never DTOs, never events.
- Transport: `transport_orders.verification` jsonb (migration
  `20260714064601_transport_verification`) — REQUIREMENTS captured at
  request (booleans/minAge only), EVIDENCE recorded by driver reports,
  `TransportOrder.verificationIssue()` = one truth for flagging; channel
  capabilities gained `ageCheck`/`deliveryPin` (own: both; uber: ageCheck
  via Uber `dropoff_verification.identification.min_age`; epod: neither) —
  resolver EXCLUDES non-ageCheck channels for restricted orders (unit
  tested); pins never gate.
- Driver API: per-stop `POST my-trips/:tripId/stops/:orderId/collected`
  ({method scan|pin, scannedRefs, pinEntered}) — trip-wide `/collected`
  stays as the bulk escape; `delivered` body carries {pinEntered, ageCheck};
  DEFERRED VERIFICATION: reports always accepted, server stamps
  verified|mismatch|not-checked, mismatch → activity `verification` entry +
  flightboard `delivery_verification_mismatch` exception;
  `POST …/verify-pin` = interactive online pre-check (in-memory limiter
  5/10min → 429, failed attempts logged detached). my-trips stops now carry
  `parcels` + `verification.requirements` (offline-first payload).
- Execution app: Work tab rebuilt — collection scan flow (wedge + camera
  via new @capacitor-mlkit dep, per-stop parcel chips n/m, auto per-stop
  collected on full scan, scan WIP persisted per order), store-PIN override
  drawer (online verify first, offline defers), delivery drawer (PIN check
  BEFORE handover, "no PIN" flag path, age attestation doc-type squares +
  visual-override only when policy allows, mismatch → "Deliver anyway
  (flagged)"), reports fall back to the mobile-kit outbox on network
  failure with local 'syncing…' overlays reconciled against server truth.
- Picking app: Picks page gained a HANDOVER section (completed picks) with
  the audited pickup-PIN reveal. Management: fulfilment side panel
  "Handover PINs — Reveal (audited)" + 🔞 badge (+ maxRestrictedAge/
  handoverPolicy on the DTO), flightboard exception meta; row click lands
  on the reveal panel.
- Generator: liquor category (~4%) with restrictedMinAge 18 → fixtures
  regenerated (36 restricted products); lines pass it through.
- Server tests 117 green; all three apps build; smoke 27/27 (see doc).
- REMAINING: real-Android camera-scan verification; picking-app handover
  section shows only picks still in the station's working set (a pruned
  set after restart won't list old completions — acceptable, flightboard
  covers those); EPOD capability flags to revisit if their side grows
  verification.

## What landed 2026-07-13 (index-pass + loose-barcode session)

**INDEX PASS (agreed next-steps item 1) — DONE.** Method: threw a synthetic
~1.9M-row dataset (60k fulfilments / 78k parts / 70k picks / 56k transport
orders / 9k trips / 600k sync_events / 480k activity_log / 300k outbox) at a
throwaway `fulfilgo_indexlab` db on the embedded PG, `EXPLAIN (ANALYZE,
BUFFERS)` over the full catalogued query list (21 queries), designed the
minimal set, re-verified, dropped the lab. Migration
`20260713183229_index_pass` applied to the dev db. Findings:

- Most of the schema was ALREADY sound at volume — embedded PG is 18 and
  btree **skip scan** rescued the queries the old map worried about
  (hasEntry, listByDriver, marketplace feed were all sub-ms before changes).
- CHANGED: `fulfilments` gained `(client_id, slot_start)` — the flightboard
  ±24h window was the one true seq scan (10.4ms → 0.39ms warm, no sort:
  index yields slot order). `activity_log` fulfilment index reshaped to
  `(fulfilment_id, category)` (client prefix was never a predicate; serves
  the hot PM `hasEntry` guard without skip-scan reliance). Release-sweep
  index now PARTIAL `(release_at) WHERE status='pending'` (32kB vs multi-MB;
  part transitions stop rewriting it). Marketplace index now PARTIAL
  `(client_id, origin_ref, slot_start) WHERE status='requested'` (48kB,
  covers feed + slot sort + findRequestedByFulfilmentExternalRef).
  DROPPED dead `idx_trips_client_store` (nothing queries trips by store).
- QUERY FIX: flightboard's picks read now passes `client_id` alongside the
  part-id IN list so `uq_picks_client_part` serves it as plain probes
  (31.5ms skip scan → 7.1ms; seq scan on PG<18 otherwise).
- NOT changed (deliberate): sync_events/outbox/telemetry/idempotency stay
  lean (all sub-ms; outbox is SDK-owned with tuned partial indexes);
  trips/transport listByClient sorts uncovered (live sets tiny);
  store-filtered fulfilments list ~11ms at 60k (management page, fine);
  no jsonb expression indexes (still none queried). Flightboard smoke-
  verified live on :3299 against the dev db (HTTP 200, 20ms).

**Loose items carry barcodes now (Andrew's ask).** The picking app's
"📦 Loose" button opens a capture drawer like Add bag: scan/type the item's
own barcode or a stuck-on printed label (recognised as `n / X`), temperature
squares, duplicate + voided-label guards — plus a "No barcode on it — add
anyway" fallback that keeps the generated `loose-N` ref (unlabelled awkward
items, stores without printers). Camera scan target 'loose' added; package
cards show the scanned ref for barcoded loose items. Contract unchanged
(`packages[].ref` was always an arbitrary string) — comments updated in
pick-outcome.contract.ts / pick.ts / picking-workflow.md.

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
| Fulfilment      | create/cancel/release + PM reactions + READY/FAILED derivations + transport trigger (ASAP/STANDARD) + COMPLETION LEG (transport terminals → completing → completed/partially_completed/failed). Missing: cancel-while-picking, commerce hook seam (process-definitions.md layer 2).                        |
| Pick            | Full vertical incl. bag-label printing (n/X pre-allocated refs, reprint, replace). Missing: pick-into-bag-directly mode, approved-substitute lists.                                                                                   |
| Picker identity | PIN-primary complete. Missing: QR badges, device enrollment, break-glass.                                                                                                                                                             |
| Stores          | Base registry + geo columns + per-domain profile assignment.                                                                                                                                                                          |
| Transport       | DEMAND SIDE LIVE (orders, resolver, trigger, uber booking/webhook). Missing: management Transport orders page (API exists), EPOD status flow BACK (their workflow/stop webhooks → order machine).                                     |
| Planning        | LIVE — Trip aggregate + group-atomic reservations + offer/claim marketplace (EPOD proxy door + native door), VROOM sequencing, sync route-plan push. Missing: execution-app consumption, real-EPOD-tenant verification.               |

## Agreed next steps (priority order)

1. ~~**INDEX PASS (Andrew, 2026-07-13)**~~ **DONE 2026-07-13** (see "What
   landed — index-pass session" above; migration `20260713183229_index_pass`
   + flightboard query fix). Original brief kept for the record: review
   access patterns across the
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
2. ~~**HANDOVER VERIFICATION**~~ **BUILT 2026-07-14** (see "What landed"
   above + docs/handover-verification.md). Original scope: collection scanning in the
   execution app (scan bags per order → order collected → trip
   auto-collects), per-part pickup PIN override (store gives it;
   server-verified, deferred when offline), per-fulfilment delivery PIN (random
   default / phone-last4 opt-in; upstream pulls via API — never in platform
   events, never shipped to the driver app), audited pin reveal on
   flightboard/management (activity-log `pin-viewed`), age checks stamped
   from line-level `restrictedMinAge` (attestation-only evidence, visual
   override only when client config permits), provider capability gating in
   the resolver. Config = new `fulfilment` section in client_settings,
   stamped at creation. Read the doc before building.
3. ~~**BAG SIZING**~~ **BUILT 2026-07-14** (see "What landed" above +
   docs/bag-sizing.md)**: client `bagSpecs` catalog (dims+units per size,
   absorbs packageUnitSizes) + pick-profile override; construction tiers
   standard|insulated|insulated-gel derived from the bag's temperature;
   dims/construction STAMPED on packages at completion; adapter fit-test
   size mapping + per-client sizeMap override (uber also gets real dims);
   loose auto-size from line volumetrics (fixes the size:null = 1 unit
   composition undercount); bags-only completion sanity check (big item
   vs small bags soft warning). Read the doc before building.
4. ~~**Execution-app migration onto the claim marketplace**~~ **DONE** —
   Work tab BUILT 2026-07-13; demo jobs vertical DELETED 2026-07-15 (see
   "What landed" above). Still open from this item: offline-queue the
   driver report calls (mobile-kit outbox, like pick outcomes — drivers
   lose signal). ~~Build the planning context~~ BUILT — server-side
   marketplace is live and smoke-verified.
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
     ~~REMAINING: per-stop reporting~~ BUILT (same session): driver
     status-report API — POST /transport/my-trips/:tripId/collected
     (trip-wide) + /stops/:orderId/{delivered,failed} (reason on failed);
     forward-only on the order machine, double-taps ACK 200
     (ALREADY_REPORTED), driver binding = the authz boundary (404 on
     another driver's trip). When the LAST order goes terminal the TRIP
     auto-completes (`trip:completed` event, registered+pushed) and drops
     off my-trips. Work tab is fully actionable: Collected button →
     per-stop Delivered/Failed chips with status badges; my-trips carries
     per-stop order status. Jobs tab REMOVED from the app chrome (routes
     still reachable). Smoke-verified live: collected → replay-ACK →
     delivered #1002 → failed #1003 ('customer not home') → trip
     completed and gone from my-trips.
     ~~REMAINING: delete the demo jobs vertical~~ DELETED 2026-07-15;
     still open: offline-queue the report calls (mobile-kit outbox, like
     pick outcomes — drivers lose signal); fulfilment completion leg now
     has its input events flowing.
   - A driver status-report surface for 'own' trips (collected/delivered/
     failed per stop → apply-transport-status), since own-channel
     execution has no webhook source.
5. EPOD status flow BACK: their workflow/stop webhooks → epod adapter
   normalizes (string references only) → TransportOrder machine — plus
   real-EPOD-tenant verification of the claim proxy + sync plan intake
   (their branch is still unpushed).
6. ~~Fulfilment completion leg~~ **BUILT 2026-07-15** (see "What landed"
   above). Still open from this item: the commerce hook seam
   (docs/process-definitions.md layer 2).
7. Management Transport orders page (list API already live) + flightboard
   delivery KPIs (transport exception kinds reserved).
8. Pick-into-bag-directly mode; picker auth phase 2 (QR/enrollment).
9. ~~Printer management + bag-label printing~~ BUILT 2026-07-13 (see
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
