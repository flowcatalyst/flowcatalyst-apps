# Bag sizing, construction & provider size mapping

Status: DESIGNED with Andrew 2026-07-14 (decisions locked below) — NOT
built. Owner contexts: client settings + pick store profile (catalog),
pick (capture), transport adapters (mapping).

## Industry grounding (2026-07 research)

- NO universal on-demand size standard exists: players standardize
  INTERNALLY (branded tote programs) and map at the provider edge.
- Provider buckets are fuzzy: Uber Direct's manifest size enum
  (small/medium/large/xlarge) has no published dims — but the API ALSO
  accepts explicit per-item `dimensions {length,width,height}`. Carrying
  real millimetres lets us send the truth; the bucket becomes a fallback.
- Grocery thermal bags cluster around 33×36×20cm; large carriers
  ~58×33×38cm. Frozen tier = INSULATED bag + GEL PACKS (~1lb gel : 2lb
  product is the meal-kit rule of thumb) — the industry names the bag
  "insulated/thermal"; the coolant is the add-on, never "a frozen bag".

## Locked decisions (Andrew, 2026-07-14 — don't relitigate)

- **Construction tiers: `standard | insulated | insulated-gel`** (UI:
  Standard / Insulated / Insulated + gel). Distinct from the TEMPERATURE
  class (contents need: ambient/chilled/frozen/hot); construction is how
  the bag delivers it.
- **Bag catalog lives in client settings with pick-profile override**:
  `client_settings.bagSpecs` = per size code (XS–XL)
  `{dims {l,w,h} mm, maxMassKg?, units}` — the capacity `units` FOLDS IN
  today's packageUnitSizes (one table, no drift). Pick store profiles
  override where a store stocks different bags. Strawman defaults
  (tote-anchored, client-tunable): XS 250×200×150 · S 300×250×200 ·
  M 400×300×250 (≈ standard tote) · L 450×350×300 · XL 600×400×400.
- **Construction DERIVES from the bag's picker-set temperature** (both
  packing modes — the picker already taps a temperature square per bag):
  ambient→standard, chilled→insulated, frozen→insulated-gel,
  hot→insulated (profile-configurable mapping), shown as a pre-selected
  chip the picker can change. Items mode additionally pre-derives the
  TEMPERATURE itself from scanned contents. Bags-only mode (expected
  DEFAULT) cannot derive from contents — Andrew.
- **Capture at completion**: pick completion resolves the size code
  against the store's bag catalog and STAMPS dims + construction onto the
  package (captured value object — a later profile retune never rewrites
  what shipped). Parcels carry them to transport unchanged.
- **Provider size mapping = fit-test + override**: adapters compute the
  smallest provider bucket whose dims contain the parcel's dims, send
  REAL dims where the API accepts them (Uber does), and a per-client
  `sizeMap` override in the provider entry config settles judgment calls
  (e.g. our S 300×300×300 vs uber 305×350×350 → force 'medium').
  Works in bags-only mode because mapping operates on BAG dims (catalog),
  not contents.
- **Loose auto-sizing**: loose items are barcode-scanned → match the pick
  line → line `volumetric` (lengthMm/widthMm/heightMm) → auto-fit to the
  smallest bag-size-equivalent, shown as a chip; ask the picker for a
  size ONLY when no product dims exist or the barcode matches no line.
  FIXES A LIVE BUG: loose parcels are size:null today and cost the
  default 1 capacity unit in offer composition — big loose items
  undercount trips.
- **Completion sanity check (Andrew's addition)**: bags-only mode can't
  verify contents fit, so completion compares picked-line volumetrics
  against DECLARED packages — any single item larger than the largest
  declared bag (and not loose), or total volume overflowing total bag
  volume, raises a SOFT warning ("big item but only small bags — add a
  bigger bag/loose, or confirm") before submit. Advisory, never a block;
  pure client-side math off already-captured volumetrics.

## Build order (when picked up)

1. Shared: `BagSpecSchema` + client-settings `bagSpecs` (absorb
   packageUnitSizes with back-compat resolution) + pick-profile override +
   construction on `PickPackageSchema` (+ dims capture).
2. Pick completion: catalog resolution + stamping; drawer construction
   chip (derived, tappable); loose auto-size; oversize sanity check.
3. Transport: parcels carry dims/construction; uber adapter sends
   `dimensions` + fit-test bucket + `sizeMap` override; offer composition
   counts loose by derived units.
4. EPOD/route-plan: surface construction (their packaging hints) — check
   their contract first.

## Open edges

- Gel-pack mass/volume overhead not modelled v1 (carried note).
- Multi-quantity loose lines: one loose parcel per scanned unit.
- Hot food may want a dedicated thermal-bag construction tier later
  (industry keeps hot/cold separate carriers); 'insulated' covers v1.
