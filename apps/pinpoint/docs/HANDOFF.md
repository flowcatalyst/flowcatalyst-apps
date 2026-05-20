# Pinpoint Port — Handoff

**Read this first if you're picking up the pinpoint port in a new session.**

## Status (2026-05-20)

- **HEAD:** Slice 5 (PostGIS canary + matching config + spatial lookup) — uncommitted
- **Slices done:** 0, 1, 2, 3, 4, 5 + PRE-0a + PRE-0b
- **Slices remaining:** 6 → 12 (~58% of the work)
- **Workspaces:** 12, all `pnpm -r typecheck` clean
- **Smoke:** server boots on port 3199; `PUT /matching-config`, `GET /matching-config`, `POST /spatial-lookup` all green against a live PostGIS-enabled Postgres
- **Drizzle migrations:** **TWO** now generated under `apps/pinpoint/server/drizzle/`:
  - `20260520171747_futuristic_zaladane` — schema (all Slice 0-5 tables, audit_logs from app-framework, geometry columns + GIST indexes)
  - `20260520171804_seed_globals` — `mcf_GLOBAL_DEFAULT` matching config + ~177-country geometry seed (verbatim port of Rust migration 016, with `ON CONFLICT (id) DO NOTHING` for re-runs)
- **Local dev DB:** `pnpm db:up && pnpm db:init && pnpm db:migrate` brings up a fresh PostGIS-enabled DB on port 5433 (see `apps/pinpoint/compose.yaml`)

## Decision factors (kept here for next re-check, Slice 6+)

The Slice 4 → Slice 5 decision point passed on 2026-05-20; Andrew opted to continue with the port. Re-evaluate again only if either of these change:
- AI ecosystem gap — Slice 7 brings the Vercel AI SDK in; if `ai`@v6 + Bedrock turns out to be meaningfully worse than the Rust `rig-core` path on the actual prompts, that would be a strong "go back" signal.
- Supply chain pain — Effect 4 is still beta-pinned. If a major Effect 4 rename lands before Slice 7 finishes, it's worth re-asking.

The original decision factors stay relevant context:
- Supply chain: Rust is meaningfully stronger (fewer deps, less npm churn, no beta lock-in)
- Safety: Rust is stronger overall; Effect closes some gaps via `Sealed<E>`
- Effect's specific wins for visibility: errors stay in the type signature, no `anyhow`-style flattening, automatic span tracing, structured concurrency — these matter for ops-heavy logistics
- AI ecosystem: rig-core is genuinely good for focused use; Vercel AI SDK only wins meaningfully for broad/agentic AI
- Hiring + frontend type sharing are the strongest *positive* reasons for TS

## What's shipped

| Slice | Commit | Scope |
|---|---|---|
| baseline | `d455e48` | Initial state of flowcatalyst-apps |
| PRE-0a | `6f2349c` + `c46b00e` (fixup) | Extract Scope/Jobs/Logging into `@flowcatalyst-apps/app-framework` |
| PRE-0b | `5357bdf` | Extract UoW infra (DrizzleOutboxDriver, TransactionStore, AggregateRegistry, commitAggregate, audit_logs schema) into `@flowcatalyst-apps/app-framework` |
| 0 | `a588006` | Pinpoint scaffold: `apps/pinpoint/{shared,framework,server,docs}` + Fastify + Drizzle + `/health` + OpenAPI |
| 1 | `138204d` | Reference + auth: Principal aggregate (no PartitionMembership FK yet), Country read-model, `GET /me`, `GET /countries` |
| 2 | `a7e34dd` | Tenancy spine: Client + Partition aggregates + UoW path, `principal_partitions` table joined in, `POST/GET /clients` and `/partitions` |
| 3 | `2d30bfc` | Locations core: `Location` aggregate (full schema, minimal create), `POST /locations`, `GET /locations/:id`, paged `GET /locations?clientId=…` |
| 4 | `13cc964` | Layers + layer-features: `Layer` + `LayerFeature` aggregates, first `commitDelete` user, `POST /layers` + `POST/PUT/DELETE/GET /layer-features`, paged reads. `property_sets`/`properties`/`layer_partitions`/`location_layer_associations` ship as schema-only |
| 5 | (this commit) | PostGIS canary: `MatchingConfig` aggregate + repo + `update-matching-config` use case, `GET/PUT /matching-config`, `POST /spatial-lookup`. Geometry `customType` (with `codec: 'text'` opt-out), GIST indexes on layers/layer_features/countries, country geometry seed (~177 rows). First two Drizzle migrations generated + applied. `docs/spatial-queries.md` captures the pattern |

Chores: `3e5726f`, `a1bcb38` (tsbuildinfo + .gitignore cleanup).

## What's deferred (and where it lands)

Tracked across slices so far. The next agent must NOT forget these:

- ~~**`countries.geometry` column + PostGIS extension + ~390KB seed**~~ → **Slice 5 — landed**
- ~~**`layers.boundary` + `layer_features.boundary` GEOMETRY columns + GIST indexes**~~ → **Slice 5 — landed**
- ~~**`location_feature_associations` table + `distance_meters`**~~ → **Slice 5 — landed (table empty; population by the matching pipeline still pending — see below)**
- ~~**pg_trgm fuzzy matching (CREATE EXTENSION)**~~ → **Slice 5 — `pg_trgm` extension installed via `pnpm db:init`. Trgm indexes on `master_locations` still deferred to Slice 8 (table doesn't exist yet)**
- **`master_locations` table** → Slice 8. `locations.master_location_id` is a nullable text column today with NO FK reference. Slice 8 adds both the table AND the FK in one migration.
- **`processing_log` table** → Slice 8
- **PropertySet + Property aggregate scaffolding** → later slice (no Rust use case exists for direct property-set management; tables ported as schema-only in Slice 4, mirroring how `location_attributes` was treated in Slice 3). `pst` prefix reserved but unregistered.
- **`location_layer_associations` population** → still pending. Table exists; population is what the matching pipeline does (next: when `create-location` grows the spatial-lookup step in Slice 5b or as part of the geocoder slice).
- **`layer_partitions` population** → later slice. Table ports in Slice 4; no `assign-layer-to-partition` use case yet.
- **Address normalization (libpostal in Rust)** → Slice 6/7 (port via a `AddressNormalizer` service Tag; no libpostal binding for TS, so decide between a hosted service, a port, or accepting reduced normalization quality)
- **LLM services (Rust `rig-core` → TS Vercel AI SDK)** → Slice 7. Three services: `AddressNormalizer`, `AddressMatcher`, `AddressVerifier`. Hidden behind Effect Tag interfaces so swapping to Mastra later is local.
- **Layer feature spatial lookup inside `create-location`** → next: the `POST /spatial-lookup` route + `LayerFeatureRepository.spatialLookup` exist, but `create-location.use-case.ts` doesn't call it. Wire it in as part of the geocoder/matching slice (6 or alongside master-locations in 8).
- **`LocationValidated` event emission** → Slice 8 (when master_locations + validation transitions land)
- **Full Rust `create_location.rs` pipeline (~600 lines: normalize → hash + fuzzy → LLM verify → master association → log)** → split across slices 6/7/8. The Slice 3 use case is the "minimal PENDING create" subset only.
- **OIDC auth** → out of scope until cutover. `extractRequestToken` in `server.ts` has the `x-user-id` dev fallback marked TODO.

## What the next agent needs to read

In order:
1. `apps/fulfil/CLAUDE.md` — **canonical pattern reference** for the entire monorepo (UoW + Sealed + Scope + processes + Effect 4 beta renames). All apps follow this.
2. `apps/pinpoint/docs/MIGRATION_PLAN.md` — pinpoint-specific design + slice ordering
3. This file
4. `MEMORY.md` — auto-loaded; gives broader context

## Slice 6 spec (if continuing)

**External services + rate limiter.** Brings in the geocoder client and (Redis-backed?) rate limiter that the matching pipeline depends on.

- Tag: `Geocoder` (Effect Tag interface in `domain/services/`)
- Infra: HTTP geocoder client. Confirm provider from Rust source — `~/Developer/tangent/pinpoint/pinpoint-infra/src/services/geocoding_client.rs` — likely Google / Mapbox / Nominatim.
- Rate limiter: port `governor` (Rust) → either an Effect semaphore or `bottleneck`. Slice 5 has `pg_trgm` enabled already but no fuzzy lookups; that lands with master_locations in Slice 8.
- Routes: `POST /geocode`
- Optional: wire `POST /spatial-lookup` into `create-location` so a created location auto-populates `location_feature_associations` from the resolved coordinate. (Reasonable to defer to Slice 8 alongside master-locations — depends on whether geocoding lands a master_locations row right away.)
- Deliverable: external geocoding callable + rate-limited, integration tests via recorded responses or testcontainers wiremock

## Gotchas

**SDK refresh after rebuild.** The `@flowcatalyst/sdk` is path-linked at `file:../../../flowcatalyst-rust/clients/typescript-sdk`. If the SDK is rebuilt, downstream consumers need `rm -rf node_modules && pnpm install` to actually pick up the new dist — `pnpm install --force` says "Already up to date" and lies. The SDK's tsconfig was recently switched to `moduleResolution: "NodeNext"` (was `"bundler"`).

**Effect 4 is beta.** Pinned at `4.0.0-beta.67`. Don't bump without checking the renames documented in `apps/fulfil/CLAUDE.md` (Either→Result, Context.Tag→Context.Service, etc.).

**`as never` cast on Scope in event constructors.** This is intentional — the SDK's `BaseDomainEvent` expects a structurally-narrower `ExecutionContext`, and pinpoint's `Scope` is a structural superset. The cast satisfies the brand. Don't try to "fix" it without understanding the seal pattern.

**Route response schemas need all status codes.** Fastify + TypeBox typechecks reply codes against the schema's declared `response` keys. Every error status the handler can emit (400/401/403/404/409/500) must be declared in the route's `response: {…}` schema. See the tenancy/locations routes for the standard `ErrorResponseSchema`.

**`*.tsbuildinfo` is gitignored** as of `a1bcb38`. If you see it appearing as untracked, that's the typecheck cache; ignore it.

**PostGIS geometry needs `codec: 'text'` on the customType.** Drizzle 1.0 RC's built-in `geometry` codec matches by SQL type prefix and routes any `geometry(*)` column through `parseEWKB`, which only handles POINT and throws "Unsupported geometry type" on POLYGON / MULTIPOLYGON. The customType in `infrastructure/schema/types/geometry.ts` passes `codec: 'text'` to opt out. If anyone ever "cleans up" that line, every read against a layer / layer_feature / country with a real geometry blows up — including from repos that never touch the boundary column directly. See `docs/spatial-queries.md`.

**Drizzle-kit `--custom` is how seeds land.** Migration journals don't include hand-dropped `.sql` files. To add a seed, run `pnpm exec drizzle-kit generate --custom --name <slug>` — it scaffolds the file AND updates `meta/_journal.json` so `drizzle-kit migrate` picks it up. The countries seed (`20260520171804_seed_globals`) is the precedent.

## Smoke commands

```bash
# typecheck everything
pnpm -r --if-present typecheck

# bring up the dev DB + apply migrations (idempotent — re-run anytime)
cd apps/pinpoint/server
pnpm db:up && pnpm db:init && pnpm db:migrate

# boot the server (DB now required for live routes)
PORT=3199 pnpm tsx src/server.ts

# verify (auth fallback: `x-user-id: alice`)
curl http://localhost:3199/health
curl http://localhost:3199/docs/json | jq '.paths | keys'

# matching-config cascade — falls back to mcf_GLOBAL_DEFAULT then promotes a scoped row on PUT
curl -s -H 'x-user-id: alice' \
  "http://localhost:3199/matching-config?clientId=cli_NONEXISTENT" | jq

# spatial-lookup at -26.108, 28.057 (must have a layer + feature with backfilled boundary)
curl -s -X POST -H 'content-type: application/json' -H 'x-user-id: alice' \
  -d '{"clientId":"<CLI>","latitude":-26.108,"longitude":28.057}' \
  http://localhost:3199/spatial-lookup | jq
```
