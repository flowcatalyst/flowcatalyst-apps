# Transport context — design sketch (pre-build)

Status: direction agreed with Andrew 2026-07-10; NOT built. This is the
next major context after picking. Inputs it needs from the fulfilment are
already captured (see "Inputs" below).

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
  captured packages), requiresVehicle, provider, providerRef (their id),
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
  the LastMileFulfilment pattern). `requiresVehicle=false` on all parts may
  route to a no-vehicle flow (walker/collection) — picker-supplied signal.
- **Events**: `fulfil-go:transport:order:*` (requested, booked, assigned,
  collected, delivered, failed) — the fulfilment PM consumes these to run
  `ready → completing → completed/failed`.

## Inputs already captured (done 2026-07-10/11)

- Part ACTUALS on the fulfilment (`fulfilment_parts.line_results/packages/
requires_vehicle`), stored by the PM from `part:picked` — parcels +
  vehicle flag are what transport quotes/books with.
- Destination/window/policies were captured at fulfilment creation.

## Open questions

- Uber Direct specifics (quote validity, webhook auth, sandbox) — spike.
- Multi-part fulfilments: one TransportOrder per part (per-store collection)
  vs consolidated multi-stop — start with one per part.
- Driver execution: reuse fulfil-go's execution-app jobs vertical as the
  'own' adapter's backend, or fulfil (the Effect app)'s last-mile? Decide
  before build.

## Provider selection & coverage (locked with Andrew, 2026-07-11)

- **Never in the fulfilment payload.** Upstream callers describe what moves
  where/when; execution is our operational decision. (Reserved, not built:
  an optional `preferredProvider` CONSTRAINT if a client contract ever
  demands one — it feeds the same resolver.)
- **Two questions, two times**: serviceability ("can we deliver here at
  all?") is an optional cheap check at fulfilment creation; provider
  SELECTION happens at transport-order creation (fulfilment READY), because
  it needs the pick actuals (requiresVehicle, packages, temperatures).
- **Config model**: providers are code — an adapter registry ('own',
  'uber', 'inmotion'), each implementing the port. Stores carry config
  referencing provider codes: `defaultProvider` + ordered `allowed[]`, each
  entry with a per-provider config blob (Uber store id, In Motion depot
  code, own-fleet zone). Client-level rows hold credentials/enablement.
  Store config is validated against the registry on write.
- **Store gains `geo` (lat/lng)** — fixtures already carry it; the registry
  schema/sync must persist it. Store as `geography(Point,4326)`.
- **Resolution**: candidates = store.allowed ∩ client-enabled → filter by
  coverage (dropoff in provider service area) + capability (requiresVehicle,
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
- **`requiresVehicle`**: Uber has NO vehicle guarantee (courier
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
