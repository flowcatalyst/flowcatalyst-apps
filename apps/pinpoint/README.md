# Pinpoint

Address resolution + spatial matching service. Workspace under
`apps/pinpoint/`:

- `server/` — Fastify API server + matching pipeline (TypeScript, Effect 4).
- `web/` — Vue 3 SPA (the operator UI).
- `shared/` — request/response contracts + permission catalog shared by
  server and web.
- `framework/` — pinpoint-specific re-exports of `@flowcatalyst-apps/app-framework`
  (UoW, AggregateRegistry, ScopeStore, etc.).
- `docs/` — `MIGRATION_PLAN.md`, `HANDOFF.md`, `route-triage.md`. Read those
  first if you're new to the project.

This README covers the running surface only: how to bring it up locally and
how to deploy it. For design choices and slice history see `docs/`.

## Architecture

```
                 ┌─────────────────────────────────┐
                 │           Vue SPA (web/)        │
                 │  served as static from server   │
                 └─────────────────────────────────┘
                                │
                                ▼
   ┌───────────────────────────────────────────────────┐
   │            Fastify server (server/)               │
   │                                                   │
   │  /api/v1/...   public REST surface                │
   │  /bff/...      UI-shaped routes (SPA-only)        │
   │  /jobs/...     FlowCatalyst-scheduled webhooks    │
   │  /docs         OpenAPI / Swagger UI               │
   │  /health       liveness                           │
   │  /*            SPA fallback (client-side router)  │
   └───────────────────────────────────────────────────┘
        │                  │                  │
        ▼                  ▼                  ▼
  ┌───────────┐     ┌─────────────┐     ┌──────────────┐
  │ Postgres  │     │  libpostal  │     │  FlowCatalyst│
  │ + PostGIS │     │   sidecar   │     │  platform    │
  │ + pg_trgm │     │ (HTTP /parse)│    │  (events,    │
  └───────────┘     └─────────────┘     │  dispatch,   │
                                        │  scheduling) │
                                        └──────────────┘
```

The server publishes domain events to FlowCatalyst's outbox (`audit_logs`
table) inside the same DB tx as the aggregate write. A scheduled job
(`pinpoint-validate-master-locations`) drains the GEOCODED master-location
backlog every 5 minutes via a platform-signed webhook.

## Local development

Bring up the dev dependencies (Postgres + PostGIS + libpostal sidecar):

```sh
# In apps/pinpoint/server/ — wires up the local DB
pnpm db:up        # docker compose -f ../compose.yaml up -d --wait
pnpm db:init      # creates the `pinpoint` schema + role-level search_path
pnpm db:migrate   # applies drizzle migrations
```

Then run the server and the SPA in two terminals:

```sh
# Terminal 1 — server on :3000
pnpm -F @pinpoint/server dev

# Terminal 2 — Vue dev server on :5173 with proxy to :3000
pnpm -F @pinpoint/web dev
```

Visit http://localhost:5173. The Vite dev server proxies `/bff`, `/api`,
`/auth` → `http://localhost:3000`. Authentication uses the `x-user-id` dev
header fallback; the SPA's API client sets it (or you can hit the API
directly with `curl -H 'x-user-id: <some-tsid>'`).

Useful scripts (in `apps/pinpoint/server/`):

- `pnpm db:studio` — Drizzle Studio against the local DB
- `pnpm db:generate` — generate a new migration from schema changes
- `pnpm flowcatalyst:sync` — push event-type schemas + role/permission
  catalog + scheduled-job definitions to the connected FlowCatalyst
  platform
- `pnpm test` — vitest run (83 tests across pure functions, service
  decorators, and orchestration with fake repos; no DB)

## Production deploy

The repo ships a multi-stage `Dockerfile` and a `compose.prod.yaml` that
brings up postgres + libpostal + the pinpoint server (which itself serves
the SPA as static files).

From the **monorepo root**:

```sh
docker compose -f apps/pinpoint/compose.prod.yaml up --build
```

The build context has to be the monorepo root so pnpm can resolve the
workspace; the compose file's `build.context: ../..` handles that.

Override environment with a `.env` file alongside `compose.prod.yaml` or
via shell exports — compose auto-loads `.env` and substitutes
`${VAR:-default}` patterns.

Default ports:

| Container       | Internal | Host         |
|-----------------|----------|--------------|
| `pinpoint`      | 3000     | `${PINPOINT_HTTP_PORT:-3000}` |
| `postgres`      | 5432     | not exposed (override the YAML if you need direct DB access) |
| `libpostal`     | 4400     | not exposed |

Visit http://localhost:3000 (or whatever `PINPOINT_HTTP_PORT` you set).

## Environment variables

Server (`apps/pinpoint/server/src/server.ts`):

| Var                              | Default                           | Meaning |
|---|---|---|
| `PORT`                           | `3000`                            | Listen port. |
| `HOST`                           | `0.0.0.0`                         | Listen host. |
| `DATABASE_URL`                   | _required in container_           | Postgres connection string (`postgres://user:pw@host:port/db`). Local dev reads from `apps/pinpoint/server/.env` via tsx. |
| `PINPOINT_PUBLIC_BASE_URL`       | `http://localhost:${PORT}`        | Public URL the server hands to FlowCatalyst for reactor / scheduled-job callbacks. |
| `FLOWCATALYST_CLIENT_ID`         | `pinpoint`                        | Tenant id used by the outbox driver for message routing. |
| `FLOWCATALYST_SIGNING_SECRET`    | _unset → dev-only_                | Shared secret platform signs scheduled-job / reactor webhooks with. **Never deploy without this set.** When unset the auth hook logs a per-request warning and lets requests through. |
| `PINPOINT_DISPATCH_POOL`         | `pinpoint-default`                | FlowCatalyst dispatch-pool code for outbound dispatch jobs. |
| `PINPOINT_GEOCODING_API_URL`     | `https://photon.komoot.io`        | Photon-compatible geocoder. |
| `PINPOINT_GEOCODING_RATE_LIMIT`  | `5`                               | Sustained geocoder requests/second. |
| `PINPOINT_LIBPOSTAL_URL`         | `http://localhost:4400`           | libpostal sidecar (`pelias/libpostal-service`). |
| `PINPOINT_LLM_PROVIDER`          | `none`                            | `none` / `bedrock` / `ollama`. LLM-backed address-match verifier. Default `none` = matching pipeline runs without LLM creds. |
| `PINPOINT_LLM_MODEL`             | provider default                  | Model id. `anthropic.claude-3-haiku-20240307-v1:0` for Bedrock, `gemma3` for Ollama. |
| `PINPOINT_OLLAMA_URL`            | `http://localhost:11434`          | Only used when `PINPOINT_LLM_PROVIDER=ollama`. |
| `AWS_REGION`                     | `us-east-1`                       | Only used when `PINPOINT_LLM_PROVIDER=bedrock`. |
| `PINPOINT_WEB_DIST_DIR`          | _unset in dev / set in container_ | Absolute path to the built SPA `dist/`. When set, the server serves it at `/` with a SPA fallback so the Vue router works. The Dockerfile sets this to `/app/web/dist`. |
| `LOG_LEVEL`                      | `info`                            | Fastify log level. |

Web (`apps/pinpoint/web/`) has no runtime env vars — the API base URL is
relative (`/bff`, `/api`) and resolved via the server's own host. For dev,
the Vite proxy in `vite.config.ts` points at `http://localhost:3000`.

## What's NOT in here yet

- **OIDC auth.** `x-user-id` is still the dev fallback for both API + BFF.
  Slice 12 (cutover) lands real OIDC + cookie sessions; until then,
  production deploys should sit behind a network-level access control.
- **Repo + use-case integration tests.** The 83-test suite covers pure
  functions and decorator behaviour; the Drizzle repo implementations
  (~10) and write use cases (~22) are not tested directly. Backfill via
  `@testcontainers/postgresql` is on the pre-cutover plan.

See `docs/HANDOFF.md` for the slice-by-slice timeline and what's deferred.
