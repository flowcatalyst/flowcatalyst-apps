# Picking workflow — modes & decisions

Status: agreed with Andrew 2026-07-10. Pick-then-pack implemented; direct
mode is a later phase.

## Assumptions

- **One order at a time** per picker (no multi-order batching — revisit later).
- The pick's `requireFullPick` (= the fulfilment's `!allowPartialFulfilment`,
  hydrated at release) gates short completion throughout.

## Pick modes (station-level; config seam for later)

1. **Pick then pack** (IMPLEMENTED) — two stages:
   - **PICK**: count each line (tap counters or barcode scan matches
     gtin/sku). Short totals blocked at this gate when `requireFullPick`.
   - **PACK**: register packages, then complete.
2. **Pick into bag directly** (LATER) — items scanned straight into bags,
   no separate pack stage. When built, mode becomes a station setting.

## Packing sub-modes (chosen per pick; all-or-none, server-enforced)

1. **Scan items into bags** (`items`): every picked unit is assigned to a
   package — contents fully known downstream. Server rejects completion
   unless packaged quantities exactly cover picked quantities per line
   (PACKAGE_ITEMS_MISMATCH). The UI tracks an ACTIVE package; scans/taps
   assign into it.
2. **Bags only** (`bags`): scan bag barcodes + attributes, no contents
   mapping. Mixing sub-modes in one completion is rejected
   (PACKAGING_MODE_MIXED).

## Packages

```
PickPackage
├── ref          bag barcode as scanned; client ref (loose-N) for loose
├── kind         'bag' | 'loose'   (loose = too big/awkward for a bag)
├── size         XS | S | M | L | XL   (bags only; loose has none)
├── temperature  ambient | chilled | frozen   (UI: Ambient/Chilled/Frozen)
└── items?       [{externalLineRef, quantity}]     (items sub-mode only)
```

- Stored on the pick (`picks.packages` jsonb) and carried on the
  `pick:picked` / `pick:short-picked` outcome events — the handover and
  transport legs know exactly what physical units they receive without
  reading back into the pick context.
- UI: size + temperature are ROWS OF PRESSABLE SQUARES with radio semantics
  (select one, others clear) — Andrew's spec.
- `packages` is optional on completion (a pick can complete unpacked — e.g.
  legacy flows); when present, ≥1 package and unique refs.

## Later

- Direct (pick-into-bag) mode + station `pickMode` setting.
- Substitutes during pick (needs the master-data gateway).
- Multi-order batch picking.
- Handover stage (bag scan at collection/driver pickup verifies packages).

## Scan-first picking (2026-07-10)

- **Scanning is the primary interaction**: each scan confirms the right
  product (gtin/sku match) and +1s the line. The always-available wedge
  input serves USB/Bluetooth keyboard-emulating scanners (works in browser
  dev); native adds the camera. Manual big-button +/- is the fallback.
- **Substitutes**: gated on `line.allowSubstitutes ?? pick.allowSubstitutes`.
  The picker scans the replacement's barcode (+ optional description + qty);
  substituted units count toward line fullness and pack coverage, and ride
  the events as `lineResults[].substitutions`. Captured-as-scanned for now —
  APPROVED substitute lists arrive with the master-data gateway.
- **Walk order**: lines sort by the per-store `attributes.aisle` value when
  the integration supplies it (zero-padded so lexicographic = walk order);
  picking in any sequence remains allowed. The generator synthesises
  deterministic aisles per (store, sku).
- **Images**: `line.imageUrl` renders with an initial-letter placeholder
  when missing or failing to load (generator seeds picsum URLs per sku).

## Line locations & pick sort (BUILT 2026-07-12)

Lines gain an OPTIONAL first-class `location` object (process input — NOT
the free-form `attributes`, which stays as-received reference data):
`{aisle?, bay?, shelf? (string|int, normalized to string), positionIndex?,
walkSequence?, locationDisplay?}`. Flows upstream payload → fulfilment
line → pick line at intake; the station shows `locationDisplay` (fallback:
composed aisle·bay·shelf).

Walk order becomes a STORE-SETTINGS field `pickSortAlgorithm` (layered:
default profile = global ⇐ store profile ⇐ store override):

- `walk-sequence` (default): walkSequence (nulls last) → aisle → bay →
  shelf → positionIndex → original order; degrades to today's aisle-only
  behaviour when only aisle data exists.
- `aisle-bay-shelf`: pure location ordering, walkSequence ignored.
- `as-received`: upstream line order preserved.

Rules: NATURAL sort on aisle/bay/shelf ("A2" < "A10"); algorithm CAPTURED
onto the pick at intake (requireFullPick hydration pattern) — config
retunes affect new picks only, a picker mid-trolley is never resorted.
Generator fixtures to carry location data so dev exercises it.

Build notes: `FulfilmentLineLocationSchema` + `line.location` in shared
value-objects (flows create -> part -> pick untouched -- the pick contracts
reuse the shared line schema); `pickSortAlgorithm` on store settings;
captured onto the pick at intake (`picks.sort_algorithm`, migration
20260712174802); shared `sortPickLines` (natural sort, nulls-last, stable --
unit-tested); PickDetailPage sorts by the captured algorithm and shows
locationDisplay (fallback composed aisle-bay-shelf, then legacy
attributes.aisle); SettingsPage has the algorithm select (empty = inherit);
generator derives deterministic per-(store,sku) locations with a SERPENTINE
walkSequence (odd aisles B1->B6, even B6->B1) -- new generated fulfilments
exercise the sort immediately.
