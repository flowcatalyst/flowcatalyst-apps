# Bag-label printing at the picking station

Status: designed 2026-07-13 against docs/picking-workflow.md's packing model;
requirements settled with Andrew 2026-07-13 (see HANDOFF). Build target: v1.

## The idea

The barcodes pickers scan into the packing drawer ARE bag labels we printed.
Printing X labels pre-allocates X package refs on the pick; each label carries
a Code 128 barcode of its ref plus a big "n / X". The packing drawer's scanned
bag refs come from these labels, so downstream (handover, transport) can count
and verify bags against a known set.

Printers are store equipment; the server renders ZPL; the PICKING APP delivers
it to the LAN printer — the cloud server can't reach store LANs.

## Printer registry (reference data, under Stores)

Table `printers` — plain reference data, no version column:

```
id prt_…  clientId  storeRef  name  host  port(9100)  dpi(203)
labelWidthMm(100)  labelHeightMm(75)  active  createdAt/updatedAt
unique (client_id, store_ref, name)
```

- Management CRUD `/clients/:id/printers` (GET list ?storeRef=, POST, PATCH
  /:printerId, DELETE /:printerId) — `ManageStores` permission (printers are
  store equipment); GET also answers picker sessions scoped to the store
  (`ViewStorePicks` + token storeRef), which is how the station's Settings
  page lists candidates.
- The STATION binds to one printer on Settings (like store binding): the
  selection is device-local (`fulfilgo.pick.station.printer` in localStorage,
  holding `{id, name}` — host/port/dims are always fetched server-side at
  render time so equipment edits take effect without re-binding).

## Label allocation — on the Pick aggregate

New `labels` jsonb column on `picks` (aggregate state, version-bumped writes):

```
PickLabelAllocation {
  count: number                      // declared bag count X; active set = seq 1..count
  labels: [{ seq, ref, reprints }]   // ref = pkg_… TSID, server-generated
  voidedRefs: string[]               // refs dropped by replace (audit + client guard)
}
```

**Refs are stable per (pick, seq)** — the invariant the whole replace design
hangs on. Label seq n keeps the same ref for the life of the pick.

Operations (picker session only — same authorize-and-load guards as
complete/fail: claim ownership, store binding, status `claimed`):

- **Allocate / replace** `PUT /clients/:id/picks/:pickId/labels`
  `{count, printerId}`:
  - no allocation yet → create labels 1..count;
  - allocation exists → REPLACE: keep seq 1..min(old,new) with their refs,
    allocate fresh refs for the extension, void refs beyond the new count.
  - Same count = idempotent re-render (no version bump when nothing changed
    → no-op replace returns the current set).
  - Response: the allocation + rendered ZPL documents for ALL active labels
    (totals "n / X" change on replace, so the whole set re-prints; kept bags
    keep their barcode — re-stickering is a totals-display nicety, scanning
    stays correct either way).
- **Reprint one damaged label** `POST …/labels/:seq/reprint` `{printerId}`:
  SAME ref, same barcode; bumps `reprints`, records an activity-log entry
  (chain-relevant once the bag is part of a completed pick). Returns that
  label's ZPL.
- **Recover** `GET …/labels`: the allocation (station restart / new station
  picks up a claimed pick — the WIP trolley is device-local, the label set is
  not).

Every mutation appends to the activity log (`subjectType: 'pick'`, category
`label-print`, action allocated|replaced|reprinted) and commits with a
`fulfil-go:pick:pick:labels-updated` domain event (platform registration rides
the next `pnpm flowcatalyst:sync`).

## Consistency with the WIP trolley (the replace flow's hard edge)

The trolley (`fulfilgo.pick.wip.<pickId>` localStorage) already persists
`packages[]` with their refs. Because refs are stable per seq:

- Bags already scanned keep their refs across a replace — no migration.
- Reducing the count below a seq whose label is already IN the trolley would
  void a ref the picker physically used. The CLIENT guards this: replace to
  count Y is blocked while any trolley package ref is in the voided set
  (message: "remove bag n first"). The server stays permissive — it can't see
  the trolley — but voided refs are returned so the client can also flag a
  stale scan (scanning a voided label warns).
- Completion validation is UNCHANGED: package refs stay client-supplied
  strings (arbitrary barcodes and `loose-N` still work — stores without
  printers keep the old flow). Printed labels are the preferred source of
  refs, not a new server-side requirement.

## ZPL rendering (server)

Pure function in the pick domain: pick + label + printer dims → ZPL string.
Layout (defaults 100×75 mm @ 203 dpi, scaled from the printer record):
part `#shortId` + store ref header, Code 128 barcode of the ref
(human-readable line under it), big `n / X`, slot date footer. `^CI28` for
UTF-8. No printer-specific extensions — plain ZPL II.

## Delivery (picking app)

- **Native (the real path — ANDROID ONLY, there is no iOS app)**: minimal
  IN-REPO Capacitor plugin `TcpPrint` (~50 lines of Java) —
  `send({host, port, dataBase64})` opens a raw TCP socket to the printer's
  :9100 and writes the ZPL. In-repo because a raw socket write is tiny and
  third-party socket plugins are exactly the npm supply-chain surface we
  hold at arm's length (workspace memory).
- **Browser dev**: Zebra Browser Print's local agent (no SDK — plain fetch to
  `http://127.0.0.1:9100/default` + `/write`). If the agent isn't running,
  the print action surfaces the error and offers the ZPL as a download.
- Print delivery is BEST-EFFORT at the client: the allocation committed
  server-side regardless; anything that didn't come out of the printer is a
  reprint away.

## Station flow (PACK stage)

1. Picker hits PACK → "Bag labels" panel: count stepper → Print → labels
   print 1/X..X/X.
2. Scan a label into the drawer (existing bag flow — ref input via wedge or
   camera), pick size + temperature squares as today. A ref matching the
   allocation shows a "Label n / X" chip; a voided ref warns.
3. Damaged label → reprint that one label from the panel.
4. Wrong count → change the stepper → Print again (replace semantics above).
5. Completion payload is untouched — the labels just filled `packages[].ref`.
