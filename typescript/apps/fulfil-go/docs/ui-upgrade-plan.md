# Management UI — grid sortability/filtering upgrade plan

Agreed 2026-08-08. Source patterns studied from the flowcatalyst-go frontend
(filter pop-out + non-blocking right drawer); adapted to the management app's
stack (Nuxt UI v4, `persistedFilter`, inspector-panel guideline in
`ui-guidelines.md`). Goal: sortability + filtering where they earn their keep,
WITHOUT turning targeted operation pages into do-everything spreadsheet grids.

## Patterns adopted from the FlowCatalyst management UI

1. **Filter pop-out, not filter sprawl** — toolbar with optional quick-search,
   1–2 primary inline selects, and a "Filters" button (active-count badge)
   opening a ~360px popover holding the structured filters. "Clear all" only
   when something is active. Filters NEVER per-column.
2. **Non-blocking right panel** — our existing 480px `?selected=` inspector
   column (ui-guidelines.md), extracted into a shared component. Clicking
   another row swaps content in place; list stays interactive.
3. **Honest truncation instead of pagination** — "Showing first N (limit
   reached) — narrow filters" footer. No offset pagination on ops pages.
4. **Sorting = clickable column headers only**, opted in per column,
   server-side on capped lists, client-side on bounded reference lists.

Divergence kept deliberately: filter state stays in `persistedFilter`
(localStorage per client — the house standard), NOT URL query sync like
flowcatalyst-go. `?selected=` covers deep links where they matter.

## Phase 0 — shared building blocks (`src/components/table/`, `src/lib/`)

- `FilterBar.vue` — quick-search (optional) + `#inline` slot + Filters
  popover (`#filters` slot) with badge + conditional Clear all.
- `SortableTh.vue` — sortable column header; v-model direction + active flag.
- `TruncationFooter.vue` — limit-reached notice.
- `InspectorPanel.vue` — extracted Fulfilments aside shell (480px column,
  header + status pill + close, scrollable body).
- `StatusBadge.vue` + `lib/format.ts` (shared `fmtDateTime`) — kill the 7
  private `fmt()` copies and 5 private color maps over time.

## Per-page changes

| Page | Filters | Sorting | Detail |
| --- | --- | --- | --- |
| Fulfilments | stores/status/type/slot-window → popover; quick-search becomes SERVER `q` (externalRef/part shortId) | Slot start, Status (server `sort`) | first consumer of shared InspectorPanel (pure extraction) |
| Picks admin | store → multi-select; slot presets → popover; add shortId `q` | Slot (shipped 2026-08-08) via SortableTh | row click → InspectorPanel (lines, picker, timestamps, link to fulfilment `?selected=`) |
| Transport orders | status multi (endpoint already CSV); store filter (new param); popover | Window/Created (server `sort`) | row click → InspectorPanel for order + trip (kill `title=` tooltips) |
| Drivers / Pickers | keep MANDATORY depot/store select; add status filter + name/code search (client-side) | staff code / name / status (client-side) | unchanged (inline ops are the point) |
| Stores | keep search; add profile filter (stores on profile X); fix filtered/total counter | ref/name/city (client-side) | unchanged |
| Printers | store select using existing `?storeRef=`; fix counter | store/name (client-side) | unchanged |

## Deliberately unchanged

- **Flightboard** — fixed ordering (exceptions top, ASAP first, ±24h) IS the
  product. No sort/filter additions; row click already routes to Fulfilments.
- **StoreProfiles** (master/detail form), **Generator** (dev tool),
  **VehicleMap** (at most clickable legend, out of scope).
- Nothing gets: per-column filter rows, multi-column sort, CSV export, offset
  pagination, or new inline cell editing.

## Server additions (all mirror the shipped slotFrom/slotTo/slotOrder shape)

- `GET /fulfilments`: `q` (externalRef/shortId prefix), `sort` + direction.
- `GET /picks/admin`: `q` (shortId), `store` → CSV multi.
- `GET /transport/orders|trips`: `store`, `sort`, honest `limit` passthrough.

## Order of work

1. Phase 0 shared components (each wired to a real consumer immediately). ✅ 2026-08-08
2. Fulfilments (proves FilterBar + InspectorPanel extraction). ✅ 2026-08-08
3. Picks admin + Transport orders (controllers currently can't inspect rows). ✅ 2026-08-08
4. Bounded reference pages (Stores, Printers, Drivers/Pickers) as cleanup. ✅ 2026-08-08

All server params shipped alongside (fulfilments q/sort/dir; picks/admin q +
store CSV; transport orders stores/sort/dir; trips stores/dir). Remaining
follow-ups: shared StaffRosterPage extraction (Drivers/Pickers duplication),
StatusBadge adoption in the older grids, VehicleMap legend toggles.
