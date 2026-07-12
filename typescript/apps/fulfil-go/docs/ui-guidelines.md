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

## Desktop management chrome (matches the FlowCatalyst management UI)

The management app replicates the flowcatalyst-go frontend shell, in Nuxt UI:

- **Collapsible sidebar** (`components/layout/AppSidebar.vue`): 260px ↔ 72px,
  navy gradient, collapse state in localStorage. Collapsed keeps icons
  (lucide via `UIcon`), hides labels + group headings, native-title tooltips.
  Active nav item = accent tint + **right-edge 3px #47a3f3 bar**
  (`.fc-nav-item-active` in main.css). Nav data in `config/navigation.ts`
  (grouped by subdomain, `i-lucide-*` icon names).
- **Profile in the sidebar footer** (`components/layout/SidebarProfile.vue`):
  gradient avatar + name + active client, opening a `UPopover` (identity,
  the client/tenant switcher input, environment footer). When real OIDC
  lands, the popover gains sign-out and the principal's actual identity.
- **Navy ramp** is registered as `--color-navy-*` tokens in the management
  app's `@theme static` (fc-navy #f0f4f8→#0a1929) — use `text-navy-900` for
  page titles, `text-navy-700` for table headers/section headings; never
  hard-code the hexes in templates.
- **Page headers**: `components/PageHeader.vue` — title (2xl/semibold navy-900)
  - optional subtitle (sm navy-500, also a `#subtitle` slot) + `#actions`
    slot right-aligned. Every page uses it.
- **Inspector panel** (Fulfilments): 480px column, bordered header row
  (title + status pill + `i-lucide-x` close), scrollable body, soft left
  shadow. Still a plain layout column per the side-panel rules below.

Mobile shell: `BottomTabBar` exposes a scoped `#icon` slot (forwarded by
`MobileShell` as `#tab-icon`) so apps render lucide `UIcon`s while mobile-kit
itself stays Nuxt-UI-free; emoji in `TabItem.icon` is the fallback. Both apps
map route → icon in `config/tabs.ts` (`TAB_ICONS`).

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
