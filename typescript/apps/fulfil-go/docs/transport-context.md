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
