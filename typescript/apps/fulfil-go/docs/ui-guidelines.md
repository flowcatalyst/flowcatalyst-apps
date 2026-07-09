# fulfil-go UI guidelines

## Theme — match pinpoint / the FlowCatalyst brand

What actually defines pinpoint's look is web-kit's **FlowCatalyst brand
palette**, not the PrimeVue preset default: a navy ramp (`--fc-navy-900:
#102a43` — the sidebar gradient, headings) and a **blue accent ramp**
(`--fc-accent-500: #0967d2`) in `packages/web-kit/src/styles/main.css`, over
slate greys, Inter, `#f8fafc` page background, white cards. (Nora's stock
emerald primary exists underneath but is not the brand.)

fulfil-go frontends are Nuxt UI v4, so the mapping is:

| Pinpoint (web-kit brand)          | fulfil-go (Nuxt UI v4)                           |
| --------------------------------- | ------------------------------------------------ |
| accent: fc-accent blues (#0967d2) | `--color-brand-*` ramp in css (`@theme static` — |
|                                   | Tailwind tree-shakes it otherwise) + `colors.    |
|                                   | primary: 'brand'` on the vite ui plugin          |
| navy: fc-navy (#102a43 sidebar)   | reserve for the management app chrome            |
| greys: slate (#f8fafc/#1e293b/…)  | `colors.neutral: 'slate'`                        |
| font: Inter → system stack        | `@theme { --font-sans: 'Inter', … }` in css      |
| page bg #f8fafc / cards white     | `bg-neutral-50` page, `UCard` default            |

Both mobile apps already carry this config (`vite.config.ts` ui plugin
options + `src/assets/main.css` @theme static block). Any future fulfil-go
frontend (the desktop management app included) must use the same two blocks —
and the management app's sidebar should use the navy gradient
(`linear-gradient(180deg, #102a43 0%, #0a1929 100%)`) like web-kit's
AppSidebar.

## Desktop management app — side-panel pattern

The fulfilment desktop app (`management-app`, :5177) uses a **non-modal inspector
side panel**, not dialogs, for detail view / edit / simple action forms:

- The panel docks right of the grid; the grid stays fully interactive while
  the panel is open — clicking another row REPLACES the panel content without
  the panel closing/reopening (no dismiss-first).
- Implementation: a layout-level split (grid flexes, panel is a fixed-width
  column), NOT `USlideover` with an overlay. If `USlideover` is used for the
  slide-in affordance, it must run with `:overlay="false"` and `:modal="false"`
  so the page behind stays clickable — but a plain layout column avoids the
  focus-trap/dismiss semantics entirely and is preferred.
- Panel contents: detail view, edit forms, and action forms **where they are
  not too complex**. Anything multi-step or large graduates to a full page —
  don't cram it into the panel.
- Panel state: driven by route query (`?selected=<id>`) so deep links and
  back/forward work; the grid row click just updates that param.

## Interaction conventions

- Writes are optimistic-lock protected server-side (409 on conflict): on a
  409, the UI refreshes the row/panel data and asks the user to retry —
  never auto-merge.
- Grids poll or subscribe (SSE) and update in place; the open panel refreshes
  when its row's data changes.
