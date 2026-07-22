# fulfil-go — On-Demand Fulfilment (picking + execution mobile apps)

Plain-async app family (like pinpoint, NOT Effect). Server patterns, the
use-case recipe, and the fulfil→pinpoint translation table live in
`apps/pinpoint/CLAUDE.md` — read that first; this file covers only what
fulfil-go adds. **Picking up work? `docs/HANDOFF.md` has the current state,
next steps, and known issues.** Design docs: `docs/fulfilment-context.md`,
`docs/pick-context-auth.md` (+ `-plan.md`), `docs/picking-workflow.md`,
`docs/transport-context.md` (next build), `docs/process-definitions.md`
(per-client process registry + integration hooks — lands with transport).

## Stack

- **Server** (`@fulfil-go/server`, PORT 3200): Fastify + TypeBox (API/event
  schemas) + Zod (domain/contracts) + pino + Drizzle/Postgres (port 5434,
  `apps/fulfil-go/compose.yaml`) + `@flowcatalyst/sdk` plain usecase surface
  via `@fulfil-go/framework`. `effect` is declared in package.json but NEVER
  imported (app-framework's entry eagerly imports the Effect UoW module).
- **Management app** (`management-app`, :5177): desktop Vue 3 + Vite + Nuxt UI
  (NO Capacitor) — navy-sidebar chrome, fulfilments grid + non-modal side
  panel (detail/cancel/processing-log), and the **fulfilment generator**
  (committed fixtures `src/generator/data/{stores,products}.json` — 100 SA
  stores + 1000 products, regenerate via `pnpm sample-data`; deliveries get a
  drop-off within 5km of the store). Imports mobile-kit ONLY via the
  web-safe subpaths (`@fulfil-go/mobile-kit/api`, `/sse`).
- **Mobile apps** (`execution-app` = driver, `picking-app` = scan-and-pick):
  Vue 3 + **Capacitor 8** + **Nuxt UI v4** + Tailwind v4. NOT PrimeVue, NOT
  web-kit components (see the workspace memory: PrimeVue is archived).
  Vite ports 5175 / 5176; dev proxy → :3200. AUTH DIFFERS PER APP: the
  execution app's browser dev uses the server's `x-user-id` dev fallback
  (`FULFILGO_AUTH_DEV_FALLBACK=true`), but the **picking app always uses real
  picker PIN login** (mobile-kit `createPickerSession` against `/pick-auth`) —
  pick endpoints authorize on the session token's `storeRef` attribute, which
  the dev fallback doesn't carry. Station binding (clientId + storeRef) is set
  on its Settings page (manual stand-in for device enrollment; see
  `docs/pick-context-auth.md` + `-plan.md`).
- **mobile-kit** (`@fulfil-go/mobile-kit`): shared mobile plumbing — fetch-
  stream SSE client (Last-Event-ID resume + backoff), offline outbox queue
  (SQLite on device / memory+localStorage in browser dev, Idempotency-Key
  headers), PKCE auth client (@capacitor/browser + deep links), token
  session, Nuxt-UI-free shell components (Tailwind only). Telemetry wrapper
  is a SUBPATH export (`@fulfil-go/mobile-kit/telemetry`) because the
  Transistorsoft plugin is an optional peer only execution-app installs.

## The three hard capabilities

1. **SSE**: use cases append to `sync_events` on the same ALS tx before
   `commitAggregate` → in-process broker (`src/sse/sse-broker.ts`) tails the
   table (poll + post-write nudge + LISTEN fulfilgo_sync) → `GET /sse/channel`
   streams per-principal (`user:<principalId>`) or per-store (picker
   sessions), replays via `Last-Event-ID`, heartbeats every 25s.
   `GET /clients/:id/sync/picks` returns `{latestEventId, picks}` for
   snapshot-then-stream. **Multi-instance safe** (ECS ≥2 nodes): an insert
   trigger NOTIFYs on commit so every node's broker wakes, and every
   sync_events read is guarded by the visibility horizon (`txid <
pg_snapshot_xmin(pg_current_snapshot())` — ids allocate before commit, so
   an unguarded cursor could skip a late-committing lower id forever; see
   sync-event-repository.ts). No sticky sessions; keep write txs short (a
   long write tx stalls SSE emission until it commits).
2. **Telemetry**: Transistorsoft NATIVE HTTP uploader posts batches to
   `POST /telemetry/locations` (bearer-authed; its `authorization` config
   refreshes tokens natively via `/auth/mobile/refresh`). Ingest is a plain
   batch insert — deliberately no outbox/aggregate. JS never touches fixes.
3. **Offline queue**: client-side outbox in mobile-kit; server dedupes via
   the `withIdempotency` plugin (`idempotency_keys` table) on accept/complete;
   the job use cases ALSO re-execute idempotently (covers the
   store-after-commit crash window).

## Conventions (house rules — apply to every new operation)

- **Optimistic locking on ALL domain operations**: aggregates carry `version`;
  repository persist guards `UPDATE … WHERE version = prior` and throws
  `ConcurrencyConflictError` (framework) on mismatch — the server error
  handler maps it to 409. See fulfilment-repository.persist. The root version
  bumps for EVERY write inside the boundary — child-entity changes (parts,
  lines, packages) included; child rows never carry their own version — and
  EXACTLY ONCE per commit: a use case composing several mutations (part
  transition + markReady derivation) bumps only on the primary transition,
  or the persist guard fails against itself. Hot aggregate? Shrink the
  boundary (Pick is its own aggregate for this reason); never skip the bump.
- **Event groups**: `messageGroup = eventGroup(aggregateCode, aggregateId)`
  from `@fulfil-go/framework` → `fulfilment-ful_XXX`. Never the SDK's
  colon-delimited `DomainEvent.messageGroup`. Applies to DISPATCH JOBS too —
  group by the aggregate whose ordering the consumer needs (normally the
  emitter): platform delivery is FIFO per group, parallel across groups.
  Never widen a group for cross-aggregate "ordering" — that's the process
  manager's job (state-guard idempotency), not the queue's.
- **Branded TSIDs**: id types are `Tsid<'ful'>` etc. via the framework's
  `brandedTsid`/`isTsid`/`asTsid` (mirrors the SDK's unexported
  `generateWithPrefix` — swap internals when the SDK exports it). `asTsid`
  throws (trusted values only); guard USER input with `isTsid` → 404.
- **CQRS-lite repository split** (Andrew, 2026-07-12): routes NEVER touch
  drizzle directly. WRITE side = repositories (`infrastructure/
*-repository.ts`): aggregate repos (guarded persists, tx-joined reads
  only for what the command needs), reference-data repos (plain idempotent
  upserts, e.g. store-profile-repository), and projection WRITERS
  (pick-session-projection — same-tx flat rows). READ side = per-surface
  QUERY modules (`*-query.ts`, e.g. flightboard-query) and SQL views
  (pick*stats*\*): pool reads, join freely, read projections/views, return
  read DTOs — never hydrate aggregates, never used for deciding a write.
  Don't build interface-heavy dual repos per aggregate; the query side is
  shaped per screen, not per table.
- **UI**: theme + desktop side-panel pattern in `docs/ui-guidelines.md`
  (FlowCatalyst brand: blue `brand` ramp primary, slate neutral, Inter,
  navy chrome on the management app).

## Gotchas

- The EXECUTION APP IS NATIVE ANDROID (`kotlin/fulfil-go-execution/`, its
  own CLAUDE.md). Its DTOs are GENERATED from the driver-app contract in
  shared (`src/api/transport.dto.ts` + `kotlin-contract.ts`), which the
  transport/driver-auth routes also enforce as request/response schemas.
  Contract change ⇒ `pnpm --filter @fulfil-go/shared gen:kotlin` or the
  native app drifts. NO $id on those schemas (they nest repeatedly in one
  route — the ajv duplicate-id gotcha below).
- `outbox_messages` is NOT in the Drizzle journal — `pnpm db:init` creates it
  (`applyOutboxTableMigration`). Without it every commitAggregate 500s.
- Don't put `$id` on TypeBox schemas that appear twice in one route schema
  (ajv rejects duplicate inline ids — bit us on the telemetry batch union).
- Transistorsoft: DEBUG builds run unlicensed; Android RELEASE needs a v9
  license key (placeholder comment in execution-app's AndroidManifest).
  Import only type exports from the plugin — runtime consts like
  `DesiredAccuracy` are type-declaration-only and break rollup.
- Nuxt UI in plain Vue: `@nuxt/ui/vite` plugin + `@nuxt/ui/vue-plugin` +
  `<UApp>` root; `auto-imports.d.ts`/`components.d.ts` are generated (git-
  ignored). Tailwind must `@source` mobile-kit's src (see apps' main.css).
- postgres:18 docker image mounts its volume at `/var/lib/postgresql`
  (NOT `.../data`).
- Platform cron expressions are 6-FIELD, SECONDS-FIRST (`0 * * * * *` =
  every minute). A 5-field cron passes the platform's shape validation and
  the job shows ACTIVE — but it NEVER fires (silent). Bit us 2026-07-10.
- Repo READ methods must join the ambient tx: `const current = () =>
resolveDb(db, TransactionStore.get())` — a bare `db.select()` inside
  runWrite grabs a second pool connection and self-deadlocks the pool under
  ≥10 concurrent writes (e.g. platform dispatch-callback bursts).

## Dev loop

Default: fc-dev's **embedded Postgres** (port 15432, user postgres/postgres). The
server reads `server/.env` (copy from `.env.example`; the embedded URL is
Option A there). `db:init` creates the separate `fulfilgo` database on the
shared instance — never point at the platform's own `flowcatalyst` db.

```bash
fc-dev                                   # the platform — hosts embedded PG on :15432
cd typescript
cp apps/fulfil-go/server/.env.example apps/fulfil-go/server/.env   # once
pnpm --filter @fulfil-go/server db:init && pnpm --filter @fulfil-go/server db:migrate  # once per fresh db
pnpm dev:fulfil-go                       # server :3200 + apps :5175/:5176
```

Pick release is platform-driven (the every-minute `fulfil-go-release-picks`
scheduled job). If fc-dev's scheduler isn't firing, set
`FULFILGO_DEV_RELEASE_SWEEP=true` for a LOUD in-process fallback — it warns
whenever it releases anything the platform cron should have (dev-only; part
of the point of local dev is proving the platform loop).

To have the platform drain fulfil-go's outbox, run fc-dev with its outbox
poller pointed at our db:
`fc-dev --outbox-enabled --outbox-db-type postgres --outbox-db-url postgresql://postgres:postgres@localhost:15432/fulfilgo`
(`fc-dev init` provisions the OAuth client + service account when you want
real OIDC instead of the dev fallback.)

Alternative (no platform running): the throwaway docker Postgres —
`pnpm --filter @fulfil-go/server db:up` and switch `.env` to Option B (port 5434).

Driver flow (the claim marketplace): management app seeds depots + drivers
(Transport → Depots/Drivers; seeded PIN 374837) → execution app Settings
binds the station (clientId + depotRef) → `/driver-login` staff code + PIN →
Work tab: Find work → claim the offer → per-stop collected/delivered/failed.
API-only smoke: `POST /clients/:id/driver-auth/login/pin` → bodyless
`POST /clients/:id/transport/offers` → `POST …/offers/:groupId/claim`.

Picking flow: management app → Pickers page → "Sync stores from fixtures" →
"Seed pickers" (staff codes P01…, shared PIN, default 385345 = FULFIL on a
keypad — NOT 123456, which Chrome flags as breached; "reset PINs" checkbox
rotates existing seeded pickers) → Generator makes
fulfilments → release sweep marks parts pick_requested → the platform
dispatcher POSTs create-pick back to `/clients/:id/picks` (needs fc-dev
`--outbox-enabled`, see above) → picking app: Settings (bind station to
clientId + storeRef) → login staff code + PIN → claim. Picks are LIVE over
SSE: pick events publish on the STORE channel `store:<clientId>:<storeRef>`
(every station at the store shares one stream; /sse/channel routes picker
sessions there by the token's storeRef attribute); snapshot-then-stream via
GET /clients/:id/sync/picks. NOTE: any new client-scoped API surface needs a
`/clients` entry in each consuming app's vite dev proxy — the picking app was
missing it and login 404'd against the SPA fallback.

Native: `pnpm build && npx cap sync` in the app dir, then open ios/android in
Xcode/Android Studio. Device-only verifications: native uploader while
backgrounded/terminated, `authorization.refreshUrl` on token expiry, and the
deep-link login round trip (`fulfilgo-exec://` / `fulfilgo-pick://`).
