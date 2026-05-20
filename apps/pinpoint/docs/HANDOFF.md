# Pinpoint Port — Handoff

**Read this first if you're picking up the pinpoint port in a new session.**

## Status (2026-05-20)

- **HEAD:** `2d30bfc` Slice 3 (locations core)
- **Slices done:** 0, 1, 2, 3 + PRE-0a + PRE-0b (6 functional commits + 2 chores + baseline = 11 commits)
- **Slices remaining:** 4 → 12 (~85% of the work)
- **Workspaces:** 12, all `pnpm -r typecheck` clean
- **Smoke:** server boots on port 3199 with 9 routes; no DB has been involved
- **Drizzle migrations:** none generated yet — run `pnpm -F @pinpoint/server db:generate` against a live Postgres when ready

## ⚠️ Decision pending — do not auto-continue

Andrew is **actively reconsidering** whether to keep porting or stop and keep the Rust pinpoint at `~/Developer/tangent/pinpoint` as the production service. The Rust version is feature-complete; only ~15% of its domain code has been ported here.

Before doing anything in `apps/pinpoint/`, **ask Andrew which way to go**. Don't blindly resume Slice 4.

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

Chores: `3e5726f`, `a1bcb38` (tsbuildinfo + .gitignore cleanup).

## What's deferred (and where it lands)

Tracked across slices so far. The next agent must NOT forget these:

- **`countries.geometry` column + PostGIS extension + ~390KB seed** → Slice 5 (PostGIS canary)
- **`master_locations` table** → Slice 8. `locations.master_location_id` is a nullable text column today with NO FK reference. Slice 8 adds both the table AND the FK in one migration.
- **`processing_log` table** → Slice 8
- **Address normalization (libpostal in Rust)** → Slice 5+ (port via a `AddressNormalizer` service Tag; no libpostal binding for TS, so decide between a hosted service, a port, or accepting reduced normalization quality)
- **pg_trgm fuzzy matching** → Slice 5
- **LLM services (Rust `rig-core` → TS Vercel AI SDK)** → Slice 7. Three services: `AddressNormalizer`, `AddressMatcher`, `AddressVerifier`. Hidden behind Effect Tag interfaces so swapping to Mastra later is local.
- **Layer feature spatial lookup inside `create-location`** → Slice 4/5
- **`LocationValidated` event emission** → Slice 8 (when master_locations + validation transitions land)
- **Full Rust `create_location.rs` pipeline (~600 lines: normalize → hash + fuzzy → LLM verify → master association → log)** → split across slices 5/7/8. The Slice 3 use case is the "minimal PENDING create" subset only.
- **OIDC auth** → out of scope until cutover. `extractRequestToken` in `server.ts` has the `x-user-id` dev fallback marked TODO.

## What the next agent needs to read

In order:
1. `apps/fulfil/CLAUDE.md` — **canonical pattern reference** for the entire monorepo (UoW + Sealed + Scope + processes + Effect 4 beta renames). All apps follow this.
2. `apps/pinpoint/docs/MIGRATION_PLAN.md` — pinpoint-specific design + slice ordering
3. This file
4. `MEMORY.md` — auto-loaded; gives broader context

## Slice 4 spec (if continuing)

**Layers + LayerFeatures.** Migrations 005, 009, 010, 013, 017.

- Aggregates: `Layer`, `LayerFeature`
- Use cases: `create-layer`, `create-layer-feature`, `update-layer-feature`, `delete-layer-feature` (the latter exercises `commitDelete` for the first time)
- Events: `layer-created`, `layer-feature-{created,updated,deleted}`
- Routes: `POST /layers`, `POST/PUT/DELETE /layer-features/...`, plus read endpoints

Pattern is identical to Slice 2 (Client/Partition). Use those as the reference. Add new aggregate registrations to `app-context.ts`'s prefix-map (suggested prefixes: `lyr` for Layer, `lfe` for LayerFeature).

Slice 5 is where the work gets meaningfully harder (PostGIS + matching). Slice 4 should be roughly the same size and shape as Slice 2.

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
