# fulfil-go — On-Demand Fulfilment (picking + execution mobile apps)

Plain-async app family (like pinpoint, NOT Effect). Server patterns, the
use-case recipe, and the fulfil→pinpoint translation table live in
`apps/pinpoint/CLAUDE.md` — read that first; this file covers only what
fulfil-go adds.

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
   table (poll + post-write nudge) → `GET /sse/channel` streams per-principal
   (`user:<principalId>`), replays via `Last-Event-ID`, heartbeats every 25s.
   `GET /sync/jobs` returns `{latestEventId, jobs}` for snapshot-then-stream.
   Multi-instance seam: swap the broker trigger for pg LISTEN/NOTIFY.
2. **Telemetry**: Transistorsoft NATIVE HTTP uploader posts batches to
   `POST /telemetry/locations` (bearer-authed; its `authorization` config
   refreshes tokens natively via `/auth/mobile/refresh`). Ingest is a plain
   batch insert — deliberately no outbox/aggregate. JS never touches fixes.
3. **Offline queue**: client-side outbox in mobile-kit; server dedupes via
   the `withIdempotency` plugin (`idempotency_keys` table) on accept/complete;
   the job use cases ALSO re-execute idempotently (covers the
   store-after-commit crash window).

## Conventions (house rules — apply to every new operation)

- **Optimistic locking on ALL domain operations**: aggregates carry `version`
  (bumped per transition); repository persist guards `UPDATE … WHERE version =
prior` and throws `ConcurrencyConflictError` (framework) on mismatch — the
  server error handler maps it to 409. See fulfilment-repository.persist.
- **Event groups**: `messageGroup = eventGroup(aggregateCode, aggregateId)`
  from `@fulfil-go/framework` → `fulfilment-ful_XXX`. Never the SDK's
  colon-delimited `DomainEvent.messageGroup`.
- **Branded TSIDs**: id types are `Tsid<'ful'>` etc. via the framework's
  `brandedTsid`/`isTsid`/`asTsid` (mirrors the SDK's unexported
  `generateWithPrefix` — swap internals when the SDK exports it). `asTsid`
  throws (trusted values only); guard USER input with `isTsid` → 404.
- **UI**: theme + desktop side-panel pattern in `docs/ui-guidelines.md`
  (pinpoint parity: emerald primary, slate neutral, Inter).

## Gotchas

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

Smoke flow (dev fallback headers): POST /jobs as `prn_dispatcher` →
POST /jobs/:id/assign {assigneeId: prn_driver1} → watch it arrive live in the
execution app (or `curl -N -H "x-user-id: prn_driver1" :3200/sse/channel`).

Picking flow: management app → Pickers page → "Sync stores from fixtures" →
"Seed pickers" (staff codes P01…, shared PIN, default 123456) → Generator makes
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
