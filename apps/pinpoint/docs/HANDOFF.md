# Pinpoint Port — Handoff

**Read this first if you're picking up the pinpoint port in a new session.**

## Status (2026-05-20)

- **HEAD:** Slice 4 (layers + layer-features)
- **Slices done:** 0, 1, 2, 3, 4 + PRE-0a + PRE-0b (7 functional commits + 2 chores + baseline + handoff doc = 13 commits)
- **Slices remaining:** 5 → 12 (~70% of the work)
- **Workspaces:** 12, all `pnpm -r typecheck` clean
- **Smoke:** server boots on port 3199 with 13 routes; no DB has been involved
- **Drizzle migrations:** none generated yet — run `pnpm -F @pinpoint/server db:generate` against a live Postgres when ready

## ⚠️ Larger decision still open — confirm before resuming

Andrew opted to continue with Slice 4 on 2026-05-20; the broader question of whether to keep porting vs keep the Rust pinpoint at `~/Developer/tangent/pinpoint` as production is **not** definitively settled. Slice 5 is where the work gets meaningfully harder (PostGIS canary + fuzzy matching) — that's the right moment to re-check the direction.

Before starting Slice 5, **ask Andrew which way to go**. Don't blindly continue.

The decision factors that came out of the analysis:
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
| 4 | (this commit) | Layers + layer-features: `Layer` + `LayerFeature` aggregates, first `commitDelete` user, `POST /layers` + `POST/PUT/DELETE/GET /layer-features`, paged reads. `property_sets`/`properties`/`layer_partitions`/`location_layer_associations` ship as schema-only |

Chores: `3e5726f`, `a1bcb38` (tsbuildinfo + .gitignore cleanup).

## What's deferred (and where it lands)

Tracked across slices so far. The next agent must NOT forget these:

- **`countries.geometry` column + PostGIS extension + ~390KB seed** → Slice 5 (PostGIS canary)
- **`layers.boundary` + `layer_features.boundary` GEOMETRY columns + GIST indexes** → Slice 5 (PostGIS canary). Scalar lat/lon/radius + polygon_geojson text shipped in Slice 4 already.
- **`location_feature_associations` table + `distance_meters` ALTER from migration 013** → Slice 5 (creates the table alongside spatial work). Slice 4 only ported the `layer_features.status` ALTER from 013.
- **`master_locations` table** → Slice 8. `locations.master_location_id` is a nullable text column today with NO FK reference. Slice 8 adds both the table AND the FK in one migration.
- **`processing_log` table** → Slice 8
- **PropertySet + Property aggregate scaffolding** → later slice (no Rust use case exists for direct property-set management; tables ported as schema-only in Slice 4, mirroring how `location_attributes` was treated in Slice 3). `pst` prefix reserved but unregistered.
- **`location_layer_associations` population** → Slice 5+ (table ported as schema-only in Slice 4; the matching pipeline populates it).
- **`layer_partitions` population** → later slice. Table ports in Slice 4; no `assign-layer-to-partition` use case yet.
- **Address normalization (libpostal in Rust)** → Slice 5+ (port via a `AddressNormalizer` service Tag; no libpostal binding for TS, so decide between a hosted service, a port, or accepting reduced normalization quality)
- **pg_trgm fuzzy matching** → Slice 5
- **LLM services (Rust `rig-core` → TS Vercel AI SDK)** → Slice 7. Three services: `AddressNormalizer`, `AddressMatcher`, `AddressVerifier`. Hidden behind Effect Tag interfaces so swapping to Mastra later is local.
- **Layer feature spatial lookup inside `create-location`** → Slice 5
- **`LocationValidated` event emission** → Slice 8 (when master_locations + validation transitions land)
- **Full Rust `create_location.rs` pipeline (~600 lines: normalize → hash + fuzzy → LLM verify → master association → log)** → split across slices 5/7/8. The Slice 3 use case is the "minimal PENDING create" subset only.
- **OIDC auth** → out of scope until cutover. `extractRequestToken` in `server.ts` has the `x-user-id` dev fallback marked TODO.

## What the next agent needs to read

In order:
1. `apps/fulfil/CLAUDE.md` — **canonical pattern reference** for the entire monorepo (UoW + Sealed + Scope + processes + Effect 4 beta renames). All apps follow this.
2. `apps/pinpoint/docs/MIGRATION_PLAN.md` — pinpoint-specific design + slice ordering
3. This file
4. `MEMORY.md` — auto-loaded; gives broader context

## Slice 5 spec (if continuing)

**Matching config + spatial lookup (PostGIS canary).** Migrations 003, 011, 012, plus the PostGIS bits from 001/005/009/015/016 that were deferred to here.

- Add the `CREATE EXTENSION postgis` migration (the only manual SQL — drizzle-kit can't emit it).
- Add `boundary GEOMETRY(Geometry, 4326)` columns + GIST indexes to `layers`, `layer_features`. Add `geometry` + GIST index to `countries`. Add the ~390KB country seed.
- Aggregate: `MatchingConfig`
- Use cases: `update-matching-config`
- Drizzle `customType` for WKT/WKB geometry; raw `sql\`...\`` for spatial predicates (`ST_DWithin`, `ST_Intersects`, `<->`)
- Routes: `PUT /matching-config`, `POST /spatial-lookup`
- Create `location_feature_associations` table + `distance_meters` column (the second ALTER from migration 013).
- Doc: `docs/spatial-queries.md` capturing the Drizzle + PostGIS pattern.
- pg_trgm fuzzy matching (`CREATE EXTENSION pg_trgm` + trgm indexes per migration 012).

This is the *first* slice that needs a live Postgres+PostGIS to validate end-to-end. Smoke commands that worked DB-less for slices 0-4 will not work for spatial routes.

## Gotchas

**SDK refresh after rebuild.** The `@flowcatalyst/sdk` is path-linked at `file:../../../flowcatalyst-rust/clients/typescript-sdk`. If the SDK is rebuilt, downstream consumers need `rm -rf node_modules && pnpm install` to actually pick up the new dist — `pnpm install --force` says "Already up to date" and lies. The SDK's tsconfig was recently switched to `moduleResolution: "NodeNext"` (was `"bundler"`).

**Effect 4 is beta.** Pinned at `4.0.0-beta.67`. Don't bump without checking the renames documented in `apps/fulfil/CLAUDE.md` (Either→Result, Context.Tag→Context.Service, etc.).

**`as never` cast on Scope in event constructors.** This is intentional — the SDK's `BaseDomainEvent` expects a structurally-narrower `ExecutionContext`, and pinpoint's `Scope` is a structural superset. The cast satisfies the brand. Don't try to "fix" it without understanding the seal pattern.

**Route response schemas need all status codes.** Fastify + TypeBox typechecks reply codes against the schema's declared `response` keys. Every error status the handler can emit (400/401/403/404/409/500) must be declared in the route's `response: {…}` schema. See the tenancy/locations routes for the standard `ErrorResponseSchema`.

**`*.tsbuildinfo` is gitignored** as of `a1bcb38`. If you see it appearing as untracked, that's the typecheck cache; ignore it.

## Smoke commands

```bash
# typecheck everything
pnpm -r --if-present typecheck

# boot the server (no DB needed for /health, /docs, schema validation)
cd apps/pinpoint/server
PORT=3199 pnpm tsx src/server.ts

# verify
curl http://localhost:3199/health
curl http://localhost:3199/docs/json | jq '.paths | keys'
curl -X POST -H 'content-type: application/json' -d '{}' http://localhost:3199/clients  # 401
curl -X POST -H 'content-type: application/json' -H 'x-user-id: alice' -d '{}' http://localhost:3199/clients  # 400
```
