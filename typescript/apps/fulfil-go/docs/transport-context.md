# Transport context — design sketch (pre-build)

Status update: **PLANNING CONTEXT BUILT 2026-07-13** (second session): Trip
aggregate (`trp_`, offered → claimed | expired | released) + group-atomic
expiring reservations on transport orders (`reservation` jsonb — expiry
frees implicitly, no sweeper); offer composition per "Offer composition"
below (anchor by part short id → fulfilment externalRef, hot-never-
consolidates, 5km companion radius, ±30min window tolerance, store-settings
caps maxStopsPerTrip/maxBagsPerTrip, VROOM sequencing via the router with
slot-order fallback); ONE claim surface at
`/clients/:id/transport/epod/{claimable-trips,claims/:groupId}` (Integral
proxy contract — their `FulfilGoClaimClient`) and
`/clients/:id/transport/offers[/:groupId/claim]` (execution app, native);
claim on 'epod' pushes the route plan SYNCHRONOUSLY
(`transport/epod/route-plan-mapper.ts` — mirrors their
`FulfilGoRoutePlansSyncTest` payload; push rejection releases the group,
driver sees offer-expired). Orders assigned on claim (booked+assigned
collapse; providerRef = trip id). Events `fulfil-go:transport:trip:*`.
allocationStrategy store setting ('claim' only, gate for future 'assign').
Smoke-verified end-to-end 2026-07-13 against a mock EPOD intake + the LIVE
router (solo, multi-stop VROOM, anchor, anchor-held, expiry release,
rejection release, idempotent re-claim, wrong-driver 410, native claim).
Remaining: status flow back from EPOD (webhooks). (Execution app migrated
to the offers door 2026-07-13; the demo jobs vertical was deleted and the
FULFILMENT COMPLETION LEG built 2026-07-15 — transport:order terminals →
/processes/fulfilment → part completed/failed → fulfilment completing →
completed / partially_completed / failed; see HANDOFF.md.)

Earlier status: **DEMAND SIDE BUILT 2026-07-13** (commit `9775e96`): TransportOrder
aggregate + events, provider registry ('own'/'epod' our-planned, 'uber'
provider-planned when creds set), resolver (transport store profile
allowed[] ∩ capability ∩ radius coverage — haversine v1 on stores.lat/lng,
same oracle seam PostGIS/pinpoint polygons slot into), PM trigger on
fulfilment:picked (ASAP immediate; STANDARD via process_reactions +
fulfil-go-transport-reactions cron sweep), book landing pad walking the
candidate chain (uber createDelivery outside tx), uber status webhook →
forward-only order machine. NOT built yet: the PLANNING context (Trip,
reservations, offer composition, claim strategy — the EPOD claim stubs
still answer empty), fulfilment completion leg, positions/map. The notes
below are the design it implements.

## The core decision: pluggable execution

Different tenants/stores move goods differently: ROA stores run OUR
execution system (driver dispatch via the execution app); others opt for
Uber (Direct) or another courier. The fulfilment must not care.

## Naming: TransportOrder

**TransportOrder** is the boundary noun — the REQUEST side ("move these
parcels from store X to destination Y within window W"), provider-neutral
(standard TMS terminology). Providers fulfil it however they do — our own
dispatch, an Uber delivery, a 3PL booking. Provider-side nouns (trip,
shipment, delivery) stay behind the adapter.

```
fulfilment READY ──(when due)──▶ request-transport ──▶ TransportOrder
                                                          │ provider port
                                        ┌─────────────────┼──────────────┐
                                     'own'             'uber'         (more)
                               driver dispatch      Uber Direct API
                               (execution app)      quote→create→track
```

## Shape

- **TransportOrder** (aggregate, `tro_` id): clientId, fulfilmentId,
  partIds, origin (store), destination, window, parcels (from the parts'
  captured packages), requiresCarOrLarger, provider, providerRef (their id),
  status: `requested → booked → assigned → collected → delivered |
failed | cancelled` (normalized across providers).
- **Provider port**: `create(order) → providerRef`, `cancel(order)`,
  status normalization from provider callbacks/polling. One adapter per
  provider; our own execution is just another adapter (dispatch jobs to the
  driver flow).
- **Provider selection**: config, store-level with client-level default
  (store registry rows grow a `transport` config blob). ROA stores → 'own';
  others → 'uber'.
- **Trigger**: the process manager reacts to its own `fulfilment:picked`
  (fulfilment READY): ASAP → request immediately; STANDARD → at
  `slotStart − transportLeadTime` (reaction bookkeeping + deadline sweep,
  the LastMileFulfilment pattern). `requiresCarOrLarger=false` on all parts may
  route to a no-vehicle flow (walker/collection) — picker-supplied signal.
- **Events**: `fulfil-go:transport:order:*` (requested, booked, assigned,
  collected, delivered, failed) — the fulfilment PM consumes these to run
  `ready → completing → completed/failed`.

## Inputs already captured (done 2026-07-10/11)

- Part ACTUALS on the fulfilment (`fulfilment_parts.line_results/packages/
requires_car_or_larger`), stored by the PM from `part:picked` — parcels +
  vehicle flag are what transport quotes/books with.
- Destination/window/policies were captured at fulfilment creation.

## Open questions

- Uber Direct specifics (quote validity, webhook auth, sandbox) — spike.
- Multi-part fulfilments: one TransportOrder per part (per-store collection)
  vs consolidated multi-stop — start with one per part.
- ~~Driver execution: reuse fulfil-go's execution-app jobs vertical as the
  'own' adapter's backend, or fulfil (the Effect app)'s last-mile?~~
  RESOLVED: the execution app's Work tab consumes the native offers door;
  the demo jobs vertical is deleted (2026-07-15).

## Provider selection & coverage (locked with Andrew, 2026-07-11)

- **Never in the fulfilment payload.** Upstream callers describe what moves
  where/when; execution is our operational decision. (Reserved, not built:
  an optional `preferredProvider` CONSTRAINT if a client contract ever
  demands one — it feeds the same resolver.)
- **Two questions, two times**: serviceability ("can we deliver here at
  all?") is an optional cheap check at fulfilment creation; provider
  SELECTION happens at transport-order creation (fulfilment READY), because
  it needs the pick actuals (requiresCarOrLarger, packages, temperatures).
- **Config model**: providers are code — an adapter registry ('own',
  'uber', 'inmotion'), each implementing the port. Stores carry config
  referencing provider codes: `defaultProvider` + ordered `allowed[]`, each
  entry with a per-provider config blob (Uber store id, In Motion depot
  code, own-fleet zone). Client-level rows hold credentials/enablement.
  Store config is validated against the registry on write.
- **Store gains `geo` (lat/lng)** — fixtures already carry it; the registry
  schema/sync must persist it. Store as `geography(Point,4326)`.
- **Resolution**: candidates = store.allowed ∩ client-enabled → filter by
  coverage (dropoff in provider service area) + capability (requiresCarOrLarger,
  frozen, ASAP) → rank, store default first → book. On provider rejection /
  terminal failure, RE-RESOLVE with the next candidate (fallback chain).
- **Coverage oracle v1 = PostGIS in our own DB**: `isCovered(provider,
storeRef, dropoff)` backed by `ST_DWithin` radius-from-store-geo (GiST
  index). Both the fc-dev embedded PG and RDS ship PostGIS. Caveat: the
  :5434 docker fallback uses plain `postgres:18` — needs the postgis image
  variant for coverage features.
- **Pinpoint = spatial truths only, later**: provider service-area polygons,
  delivery areas, collection points live in pinpoint layers WHEN a provider
  needs polygon-level truth (Uber coverage). Consumed via a SYNCED local
  read model behind the same coverage-oracle interface — never a synchronous
  call in the hot path (pinpoint down = stale coverage, not failed orders).
  Pinpoint is NOT the system of record for provider config (that needs
  registry validation + versioning with the domain).
- Collections need no provider; collection points are a natural future
  pinpoint layer (display, nearest-lookup, geofenced arrival).

## Uber Direct adapter (BUILT 2026-07-11 — server/src/transport/)

**Decision: direct API, no SDK.** npm `uber-direct` 0.1.8 (Oct 2024) is ~20
months stale — missing the 2025–26 changelog (cancel reasons, list params,
item_customizations, refund API, …) and has no webhook-signature helper;
the DaaS surface is 7 endpoints. We own typed wire types instead
(`server/src/transport/uber/types.ts`; the official OpenAPI lives in the
SDK repo if ever needed for regeneration).

What exists now (transport aggregate still to come):

- `server/src/transport/provider-port.ts` — the provider port: normalized
  status machine, TransportStop/Parcel/Quote/Booking shapes, adapter
  interface + `capabilities.vehicleGuarantee`.
- `server/src/transport/uber/` — client (OAuth client-credentials at
  auth.uber.com, scope `eats.deliveries`, 30-day token cached — the token
  endpoint is 100 req/hr), adapter, webhook verify/normalize, 15 unit tests.
- `server/scripts/uber-smoke.ts` — quote → robo-courier delivery → poll to
  delivered, against test credentials.

Adapter rules (locked):

- **`pickup_ready_dt` = slot start, NEVER earlier** (hours-of-operation
  rejections); clamped to now when the slot already began (Uber rejects
  past times). Deadline = slot end floored to Uber's minimums (ready+10min,
  now+20min).
- **Quote-at-receipt is cheap**: quotes take NO manifest — just addresses/
  geo/window/value. Quote on fulfilment receipt when the resolver says
  uber; book after picking with the actuals. Quotes expire in 15 min and
  are single-use — always re-quote at booking time if stale.
- **Manifest sizes = captured bag sizes** (XS,S→small, M→medium, L→large,
  XL→xlarge). `obfuscateManifest` (per-client policy — theft concern from
  the first client): item names become package refs/barcodes, never goods.
- **`requiresCarOrLarger`**: Uber has NO vehicle guarantee (courier
  vehicle_type is informational) → `capabilities.vehicleGuarantee=false`
  for the resolver + a best-effort nudge (largest item forced xlarge).
- Status map: pending→booked, pickup→assigned, pickup_complete/dropoff→
  collected, delivered→delivered, canceled→cancelled, returned→failed.
  `courier_imminent` is a flag, not a status.
- Uber-side idempotency: `idempotency_key` (60-min window) → 409
  `duplicate_delivery` recovered by fetching `metadata.delivery_id`.
- Webhooks (configure in the Direct dashboard, per environment):
  `x-uber-signature` = lowercase-hex HMAC-SHA256 of the RAW body; verify
  with `verifyUberSignature` (raw body BEFORE json parsing), respond 2xx
  fast (retries: 10s/30s/60s/120s, max 3). `event.courier_update` fires
  every 20s once assigned.
- Test mode = SEPARATE CREDENTIALS (same URLs, `live_mode:false` on every
  response/webhook; sandbox limit 200 req/10min). Robo Courier:
  `test_specifications.robo_courier_specification` — `{mode:'auto'}` walks
  the lifecycle at 30s steps, or explicit timestamps + optional
  `cancel_reason` simulations.
- Wire gotchas: addresses are JSON-STRINGIFIED strings; money integer
  CENTS; weight grams / dims cm; RFC 3339 UTC datetimes; phones ^\+[0-9]+$;
  `external_store_id` must match between quote and delivery if used.

## Execution channels, planning context & EPOD strategy (direction, Andrew 2026-07-12)

**Three concerns, only one of which existed in the design so far:**

- DEMAND — TransportOrder (designed above): what must move. Request side.
- PLANNING — grouping orders into TRIPS, stop sequencing, solver
  optimization (VROOM via the router service), offer/claim vs direct-assign
  modes. DID NOT EXIST in the design; needed. New context: **Transport
  Planning** (Trip aggregate).
- EXECUTION — a driver doing it: our execution app, EPOD's driver app, or
  Uber's couriers.

Provider split by who PLANS:

- **Provider-planned** (uber): provider port as designed — quote/book/track,
  no planning on our side.
- **Our-planned channels** ('own' app, 'epod'): the "adapter" is thin — it
  hands READY TransportOrders to OUR planning context, which builds trips
  (v1: one order = one trip; router/VROOM for multi-order later) and runs
  ONE claim surface (the pick-app pattern: advertise → claim,
  optimistic-locked, mode per store/client via store profiles: 'claim' vs
  'assign'). Our execution app consumes it natively; EPOD consumes it via
  translation (below). One marketplace, two driver apps.

**EPOD integration plan** (see epod-integration-notes.md for the
integration detail):

- Their claim endpoints get UPDATED to PROXY to fulfil-go (driver app
  untouched — the point of incremental adoption). Offer request carries
  driverReference/vehicleRegistration/depot/territory through the proxy.
- Offer ⇒ our epod adapter takes a RESERVATION on the trip/orders — a
  proper expiring, optimistic-locked hold in OUR store (mirrors their 30s
  TTL but lives where the state lives, avoiding offer/claim races).
  Driver+vehicle bind at OFFER time (their semantic — preserve it).
- Claim ⇒ we IMMEDIATELY push the route plan to a NEW EPOD ingest endpoint
  that processes SYNCHRONOUSLY (making route-plan acceptance an explicit
  success/failure signal): success → trip booked/assigned; failure
  → reservation released, driver sees "offer expired". Push idempotent on
  our trip reference.
- Status flow back: their workflow/stop events → webhook → epod adapter
  normalizes (stop refs are strings — NEVER numeric ids, unstable per
  tenant) → TransportOrder machine.
- **Master-data pre-provisioning**: NEW EPOD upsert APIs for destination
  locations + products. Trigger (Andrew 2026-07-12): the PROCESS MANAGER
  creates a platform DISPATCH JOB on `fulfilment.created` whenever EPOD is
  the default or an available execution system for the origin store — the
  dispatch job targets the epod adapter's provisioning endpoint
  (idempotent, keyed on our refs, platform retries — order intake is never
  blocked). Topology (manually maintained in EPOD): territories and depots
  are set up by hand; depots link to manually-created `epod_locations`
  rows and to a territory. ORIGIN linkage needs no provisioning: the
  incoming fulfilment part's origin reference (`origin.ref`) IS the EPOD
  location reference → depot → territory. TENANT mapping: our client code
  == EPOD tenant code (`Tenant::query()->where('code', clientCode)`).
- **Auth for the new EPOD endpoints: FlowCatalyst access tokens** via the
  monorepo's EXISTING middleware alias `fc.or-passport`
  (`\FlowCatalyst\Auth\Http\Middleware\AuthenticateServiceTokenOrFallback`
  — accepts a FlowCatalyst service token or falls back to Passport). Do
  NOT use laravel-simple-token-auth. NB the FC token audience contract:
  aud == iss == platform base URL, NOT client_id.

**Positions + map**: unified `transport_positions` ingest (provider,
tripRef, vehicle/courier, lat/lng, ts; latest-per-vehicle + optional
history): our app = Transistorsoft native uploader (telemetry path exists),
EPOD = telemetry/stop webhooks, Uber = courier location already extracted
by the adapter (event.courier_update every 20s). Map page in management app
= MapLibre GL against the router service's OSM VECTOR tile server; live via
the ops SSE channel. Natural flightboard companion view.

**Adoption path**: (1) transport context + Uber [adapter built], (2)
planning v1 (1 order = 1 trip) + own-app claim/assign, (3) EPOD channel
(claim proxy + reservation + sync route push + provisioning APIs), (4)
router/VROOM multi-order trips + positions map. Stores migrate
channel-by-channel via store-profile provider config — the incremental
off-EPOD story is a config change per store, not a cutover.

## EPOD adapter (fulfil-go side) — BUILT 2026-07-12 (provisioning + claim stubs)

The fulfil-go half of the EPOD channel's integration plumbing exists; the
planning-context pieces (reservation/claim/route-plan push) remain stubs
until the transport context lands.

- `server/src/transport/epod/` — typed `EpodClient` (uber-client pattern):
  FlowCatalyst SERVICE-TOKEN auth (client-credentials at
  `{FLOWCATALYST_URL}/oauth/token`, cached with margin; their side
  validates via `fc.or-passport`), `X-INHANCE-TENANT` header, endpoints
  `POST {base}/api/v1/tms/epod/fulfilgo/{locations/upsert,products/upsert,
routes/plans}` (route plan loosely typed until the claim flow). Pure
  provisioning mapper + unit tests alongside.
- **Provisioning trigger**: store settings gained OPTIONAL
  `executionSystems: string[]` / `defaultExecutionSystem` (API-set — no UI;
  the Settings page preserves them on save but doesn't edit them). The
  fulfilment PM subscription now also receives
  `fulfil-go:fulfilment:fulfilment:created`; the decider
  (`operations/epod-provisioning`) dispatches a platform job to
  `/clients/:id/epod/provision` when any origin store selects 'epod'.
  Exactly-once: 'epod-provision-dispatched' processing-log entry as the
  state guard (same tx as the outbox write) + dispatch idempotency key;
  fact event `…:epod-provision-requested`.
- **Landing pad** `POST /clients/:id/epod/provision` (HMAC dispatch
  target): upserts the delivery destination (ref = `location.ref` else
  `fulfilgo-dest-{fulfilmentId}`; skipped when no geo or collect) + all
  parts' products (deduped by sku). Idempotent by construction; failures
  500 for platform retry; env unset (`FULFILGO_EPOD_BASE_URL` /
  `FULFILGO_EPOD_TENANT_CODE`) logs + skips.
- **Claim surface stubs**: `POST /clients/:id/transport/epod/
claimable-trips` → `{offers: []}` and `POST …/claims/:groupId` → 410 —
  Integral's claim proxy targets; the planning context fills them in
  (offer reservation, driver+vehicle bound at offer time, sync route-plan
  push on claim).

## Offer composition — multi-stop + anchor claims (Andrew, 2026-07-13)

The planning context's claimable-trips composition (fills the current stub;
the offer contract already carries plural transportOrderRefs/partReferences
under one groupId, and orderReference already flows driver app → Integral
proxy → our endpoint):

- **Multi-stop WHEN POSSIBLE**: an offer is a TRIP (ordered stop sequence —
  a single-order trip is just the degenerate case). Compose greedily from
  READY transport orders at the driver's store/depot:
  compatibility filters first — same origin store, slot windows overlapping
  within a tolerance, combined capacity within the vehicle's practical
  limit (bag counts/sizes from the pick actuals; requiresCarOrLarger honoured),
  temperature mix acceptable — then SEQUENCE the dropoffs via the router
  service (VROOM); cap stops (config: maxStopsPerTrip, store-settings
  layered) and cap total detour vs the single-order baseline.
- **Anchor claims ("visible id")**: the driver-entered reference resolves
  against the part SHORT ID (per store + service-day — the number on the
  packaging) falling back to fulfilment externalRef. If the anchor's
  transport order is offerable at that store: it goes in the offer FIRST,
  then companions are selected by the same compatibility filters ranked by
  least added detour to the anchor's route. If the anchor is not available
  (claimed/gone/not ready): empty offer with the reason — never substitute
  a different order for an explicit request.
- **Reservation covers the WHOLE group atomically** (the expiring
  optimistic-locked hold): all orders in the offer reserve together or the
  offer shrinks before being presented — no partial-claim races. Claim →
  ONE multi-stop route plan pushed synchronously (their intake is natively
  multi-stop); rejection releases the whole group.
- Offer ranking default when no anchor: ASAP first, then oldest slot
  (flightboard rule), then best multi-stop consolidation.

## Allocation strategies (Andrew, 2026-07-13 — locked)

How planned trips reach drivers is a NAMED STRATEGY, selected via store
settings (layered, like pickSortAlgorithm): **`claim` is the default** —
our OWN execution app consumes the SAME offer/claim surface as EPOD (one
marketplace, one reservation model, same offer composition incl. multi-stop
and anchor claims; the execution app simply speaks it natively instead of
through the Integral proxy). Future strategies slot in behind the same
port: `assign` (dispatcher-directed), later perhaps `auto-assign` /
`broadcast`. Strategy is a planning-context concern — execution channels
(own app / EPOD driver app) are consumers of whatever the strategy
surfaces. This supersedes any claim-vs-assign wording above: it is one
strategy port with 'claim' first.
