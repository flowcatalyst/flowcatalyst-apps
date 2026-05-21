# Pinpoint Port — Handoff

**Read this first if you're picking up the pinpoint port in a new session.**

## Status (2026-05-21)

- **HEAD:** `d02aee8` Slice 10b.3 (LocationAttribute scaffolding + principal-partition grant/revoke)
- **Slices done:** 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10a, 10b.1, 10b.2, 10b.3 + PRE-0a + PRE-0b + schema-sync
- **Slices remaining:** 10c (BFF mount), 11 (Vue lift), 12 (cutover + testcontainers backfill)
- **Workspaces:** 12, all `pnpm -r typecheck` clean
- **Tests:** 83 passing across 11 files (`pnpm -F @pinpoint/server test`)
- **Drizzle migrations:** two generated, applied (schema + countries/global-default seed) — see `apps/pinpoint/server/drizzle/`
- **Local dev:** `pnpm db:up && pnpm db:init && pnpm db:migrate` brings up a fresh PostGIS-enabled DB on port 5433 + the pelias/libpostal-service sidecar (Slice 8 wired into `apps/pinpoint/compose.yaml`)

## Decision factors

All in-flight decision points (Slice 4 → 5 → 7 named re-checks) passed on 2026-05-20/21. The Vercel AI SDK / Ollama gemma4 path produced clean structured output with the Rust-ported prompts — no rig-core regression. The Slice 8 matching pipeline matches the Rust pinpoint's behavior end-to-end (PENDING → GEOCODED → VALIDATED with EXACT_HASH dedup on resubmission). The port is now functionally caught up.

Re-evaluate again only if:
- Effect 4 ships a major rename that breaks the use-case shape before cutover (still beta-pinned at `4.0.0-beta.67`)
- The BFF surface in Slice 10c turns out to be much heavier than the ~2530 LoC route-triage suggests

Original decision factors (kept for posterity / future re-checks):
- Supply chain: Rust meaningfully stronger (fewer deps, less npm churn, no beta lock-in)
- Safety: Rust stronger overall; Effect closes gaps via `Sealed<E>`
- Effect wins for visibility: typed error channel, automatic span tracing, structured concurrency
- AI ecosystem: rig-core good for focused use; Vercel AI SDK wins for broad/agentic AI
- Hiring + frontend type sharing are the strongest positive reasons for TS

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
| 5 | `dac0b43` | PostGIS canary: `MatchingConfig` aggregate + repo + `update-matching-config` use case, `GET/PUT /matching-config`, `POST /spatial-lookup`. Geometry `customType` (with `codec: 'text'` opt-out), GIST indexes on layers/layer_features/countries, country geometry seed (~177 rows). First two Drizzle migrations generated + applied. `docs/spatial-queries.md` captures the pattern |
| 6 | `5323e76` | External services: Photon `GeocoderService` + Effect 4 `RateLimiter`-backed decorator, `POST /geocode/forward` + `POST /geocode/reverse`, `NormalizedAddress` data type, 25 tests (first in the codebase) covering Photon parsing/error paths/User-Agent/query string + rate-limiter wall-clock behavior + trigram-key stability |
| 7 | `b4f6620` | LLM `AddressVerifier`: Bedrock (Vercel AI SDK `generateObject`) + Ollama (native `/api/chat` with JSON-schema `format`) + Noop. `POST /verify-match` debug route. Env-driven provider selection (`PINPOINT_LLM_PROVIDER` / `_MODEL` / `_OLLAMA_URL`). 15 new tests; smoke against local Ollama+gemma4 green |
| 8 | `72b812d` + `b4981c6` | Master locations + the full matching pipeline. `MasterLocation` aggregate (PENDING/GEOCODED/VALIDATED/REJECTED) + repo + processing_log table. `AddressMatcher` pure module (Jaro-Winkler + 80-entry SUBSTITUTIONS) + `AddressNormalizer` (libpostal HTTP via `pelias/libpostal-service` sidecar, added to `compose.yaml`). Rewritten `create-location` use case running the full Rust pipeline (normalize → hash + fuzzy + matcher → LLM verify → master association OR creation → spatial lookup for VALIDATED-master case → LocationValidated). Two new use cases: `validate-master-location` (geocode) and `confirm-master-location` (canonicalize + cascade). 4 new routes under `/master-locations`. 28 new tests including the Rust matcher unit-test trio. End-to-end smoke green: PENDING → GEOCODED → VALIDATED with EXACT_HASH match on second submission of same address. |
| schema-sync | `5f4685e` | Event-data interfaces → TypeBox + `addSchemaVersion` push from `scripts/sync-flowcatalyst.ts`. All 12 events now carry payload JSON Schemas to the platform |
| 9 | `2726201` | FlowCatalyst-scheduled validation worker. `pinpoint-validate-master-locations` runs every 5 minutes via a platform-fired webhook (`POST /jobs/validate-master-locations`), draining the GEOCODED backlog 100 masters at a time and calling `confirm-master-location` on each. HMAC verification via ported `flowcatalystWebhookAuthHook`. `runJob` wraps the batch in `SystemIdentity.SCHEDULER` scope. ScheduledJobDefinition wired into the DefinitionSet, sync-able via `pnpm flowcatalyst:sync`. 15 new tests (HMAC + batch orchestration) |
| 10a | `4442d4c` | Path-scope rewrite. All flat routes (`/locations`, `/layers`, `/partitions`, `/matching-config`, `/spatial-lookup`, `/master-locations/*`) moved under `/clients/:clientId/...` to match the Rust API shape. Layer features nest further as `/clients/:cid/layers/:lid/features/*`. `/me`, `/countries`, `/health`, `/geocode/*`, `/verify-match`, `/jobs/*` stay flat (no client scope). New `docs/route-triage.md` catalogues every Rust route file + its TS-side status, including the deferred CRUD ops for 10b and the BFF surface for 10c |
| 10b.1 | `219ea59` | Existing-aggregate CRUD. `update-client` + `delete-client`, `update-partition` + `delete-partition`, `update-layer` + `delete-layer`, `update-master-location` + `reject-master-location`. |
| 10b.2 | `994741d` | PropertySet aggregate (`pst` prefix registered) + four use cases: `create-property-set`, `update-property-set`, `delete-property-set`, `replace-property-set-properties` (bulk PUT of all child properties on a set, capped at 6 per Rust). Properties are managed inline as child entities — no per-Property aggregate, matching the BFF's `replace_properties` single-op shape. |
| 10b.3 | `d02aee8` | LocationAttribute (`lat` prefix registered) + extend `create-location` to write `attributes[]` inline in the same UoW tx (early-validates non-empty keys, rejects duplicates as `BusinessRuleViolation`). Plus `PrincipalRepository.grantPartitionAccess` / `revokePartitionAccess` / `findPrincipalsForPartition` — three plain repo methods, no aggregate / event / use-case wrapper (matches Rust). Routes for grant/revoke land in Slice 10c; no standalone attribute-update/delete use case ever (matches Rust). Closes out Slice 10b. |

Chores: `3e5726f`, `a1bcb38` (tsbuildinfo + .gitignore cleanup).

**Slice 10b sub-numbering note:** the original spec assigned LocationAttribute + principal-partition to a single "10b.3" alongside Property CRUD; what actually shipped split them: PropertySet got its own 10b.2 first, then 10b.3 picked up LocationAttribute + principal-partition. Net scope matches the original Slice 10b list — just rearranged sub-numbers.

## What's deferred (and where it lands)

What's actually left vs. what's already done. Don't re-do completed items.

**Done (struck through for posterity):**

- ~~`countries.geometry` + PostGIS extension + ~390KB seed~~ → Slice 5
- ~~`layers.boundary` + `layer_features.boundary` GEOMETRY columns + GIST indexes~~ → Slice 5
- ~~`location_feature_associations` table + `distance_meters`~~ → Slice 5 (populated by the matching pipeline in Slice 8)
- ~~`pg_trgm` extension + trgm indexes on `master_locations`~~ → Slice 5 / Slice 8
- ~~`master_locations` table + `processing_log` table~~ → Slice 8
- ~~`PropertySet` aggregate scaffolding~~ → Slice 10b.2
- ~~`location_layer_associations` population~~ → Slice 8 (`create-location` calls `spatialLookup` for the VALIDATED-master case and writes associations)
- ~~Address normalization (libpostal)~~ → Slice 8 — pelias/libpostal-service HTTP sidecar in `compose.yaml`
- ~~`AddressMatcher` (Jaro-Winkler + substitutions)~~ → Slice 8
- ~~LLM `AddressVerifier`~~ → Slice 7 (Bedrock + Ollama + Noop)
- ~~Layer feature spatial lookup inside `create-location`~~ → Slice 8
- ~~`LocationValidated` event emission~~ → Slice 8
- ~~Full Rust `create_location.rs` pipeline~~ → Slice 8
- ~~`LocationAttribute` scaffolding + inline attribute writes~~ → Slice 10b.3 (`lat` prefix; inline in `create-location` only — no standalone attribute CRUD, matches Rust BFF)
- ~~`PrincipalRepository` grant/revoke/list~~ → Slice 10b.3 (plain repo methods, no aggregate/use-case wrapper — matches Rust)

**Still pending:**

- **`layer_partitions` population** → no `assign-layer-to-partition` use case yet. Currently no BFF surface needs it; revisit in Slice 10c if a route requires it.
- **BFF surface mount** → Slice 10c. All 11 BFF route files from `docs/route-triage.md` remain to port. Each delegates to existing use cases (writes) or repositories (reads) with `{items, total}` framing.
- **`master-locations/unvalidated` route** → Slice 10c. Rust `routes/unvalidated_routes.rs` listing-with-filters; backed by `MasterLocationRepository.listByStatus` (already exists from Slice 9).
- **`fragment_routes` (askama HTML)** → WILL NOT PORT. The Vue SPA owns the UI; nothing calls fragment endpoints.
- **Web lift** → Slice 11. Copy `~/Developer/tangent/pinpoint/pinpoint-web/` → `apps/pinpoint/web/`, retarget API base URL, `pnpm -F @pinpoint/web dev` smoke.
- **OIDC auth + cookie sessions for BFF** → Slice 12. `extractRequestToken` still on the `x-user-id` dev fallback. Hardening before production cutover.
- **Docker Compose for full stack (postgres + pinpoint server + web + libpostal sidecar) + Dockerfile + README** → Slice 12.
- **Infra-repo + use-case integration tests** → final pre-cutover hygiene slice. None of the Drizzle repo implementations (`createDrizzleClientRepository`, `…LayerRepository`, `…MasterLocationRepository`, `…PrincipalRepository`, etc.) and none of the use cases are tested directly. The current 83 tests cover pure functions, service decorators (fetch-mocked), and orchestration with fake repos. Backfill plan: bring in `@testcontainers/postgresql`, write integration tests for every Drizzle repo (~10) + every write use case (~22). Land before Slice 12 cutover.

## What the next agent needs to read

In order:
1. `apps/fulfil/CLAUDE.md` — **canonical pattern reference** for the entire monorepo (UoW + Sealed + Scope + processes + Effect 4 beta renames). All apps follow this.
2. `apps/pinpoint/docs/MIGRATION_PLAN.md` — pinpoint-specific design + slice ordering
3. This file
4. `MEMORY.md` — auto-loaded; gives broader context

## Slice 10b status (closed)

Slice 10b is closed out. What shipped, in order:

- **10b.1** (`219ea59`): client/partition/layer update + delete, master-location update + reject — 8 use cases against existing aggregates.
- **10b.2** (`994741d`): PropertySet aggregate + 4 use cases (create/update/delete + `replace-property-set-properties` bulk PUT, cap 6 per Rust).
- **10b.3** (`d02aee8`): LocationAttribute (`lat` prefix) scaffolding + inline attribute writes from `command.attributes` in `create-location`. Plus `PrincipalRepository.{grant,revoke}PartitionAccess` + `findPrincipalsForPartition` — three plain repo methods, no aggregate / event / use-case wrapper (matches Rust).

Out-of-scope for Slice 10b (kept here so it doesn't sneak back in):

- Per-attribute update/delete on `LocationAttribute` — Rust BFF doesn't expose them. Attributes are managed inline at location creation only.
- Routes for grant/revoke partition access — those land in 10c as part of `/bff/clients/:cid/partitions/:pid/principals`.
- `assign-layer-to-partition` use case (i.e. `layer_partitions` population) — no current BFF route requires it; revisit in 10c if needed.

## Slice 10c spec (next up)

**BFF surface mount** under `/bff/clients/:cid/...`. Each endpoint
delegates to existing use cases (writes) or repositories (reads) with
`{items, total}` UI-shaped responses. Includes:

- `GET /bff/dashboard/stats`
- `GET /bff/countries`
- `GET /bff/clients/:cid` + the 11 nested BFF route files (see triage doc)
- `/master-locations/unvalidated` (from `routes/unvalidated_routes.rs`)
- BFF auth: continues to use the `x-user-id` dev fallback for now;
  real OIDC + cookie sessions land in Slice 12.

## Gotchas

**SDK is git-tag tracked, not path-linked.** As of 2026-05-20, all five workspaces that consume `@flowcatalyst/sdk` use `github:flowcatalyst/typescript-sdk#semver:>=0.6.7`. The git tag list is the resolution source (pnpm strips a leading `v` and matches against the spec); the package.json `version` field on the tag is stale and unreliable (v0.6.7 still claims 0.3.2). The previous `file:../../../flowcatalyst-rust/clients/typescript-sdk` path link was retired because it went stale silently between SDK rebuilds and required `rm -rf node_modules && pnpm install` to refresh (`pnpm install --force` lies and says "Already up to date").

**Standing rule: run `pnpm update @flowcatalyst/sdk -r` at the start of every new task** before doing anything else. The semver range floats but pnpm only re-resolves on explicit update. The dev SDK ships out-of-band, often weekly. If the update bumps the locked commit, run `pnpm -r --if-present typecheck` immediately so any SDK-induced breakage is attributed to the bump and not to whatever task you're about to start.

**Effect 4 is beta.** Pinned at `4.0.0-beta.67`. Don't bump without checking the renames documented in `apps/fulfil/CLAUDE.md` (Either→Result, Context.Tag→Context.Service, etc.).

**`as never` cast on Scope in event constructors.** This is intentional — the SDK's `BaseDomainEvent` expects a structurally-narrower `ExecutionContext`, and pinpoint's `Scope` is a structural superset. The cast satisfies the brand. Don't try to "fix" it without understanding the seal pattern.

**Route response schemas need all status codes.** Fastify + TypeBox typechecks reply codes against the schema's declared `response` keys. Every error status the handler can emit (400/401/403/404/409/500) must be declared in the route's `response: {…}` schema. See the tenancy/locations routes for the standard `ErrorResponseSchema`.

**`*.tsbuildinfo` is gitignored** as of `a1bcb38`. If you see it appearing as untracked, that's the typecheck cache; ignore it.

**PostGIS geometry needs `codec: 'text'` on the customType.** Drizzle 1.0 RC's built-in `geometry` codec matches by SQL type prefix and routes any `geometry(*)` column through `parseEWKB`, which only handles POINT and throws "Unsupported geometry type" on POLYGON / MULTIPOLYGON. The customType in `infrastructure/schema/types/geometry.ts` passes `codec: 'text'` to opt out. If anyone ever "cleans up" that line, every read against a layer / layer_feature / country with a real geometry blows up — including from repos that never touch the boundary column directly. See `docs/spatial-queries.md`.

**Drizzle-kit `--custom` is how seeds land.** Migration journals don't include hand-dropped `.sql` files. To add a seed, run `pnpm exec drizzle-kit generate --custom --name <slug>` — it scaffolds the file AND updates `meta/_journal.json` so `drizzle-kit migrate` picks it up. The countries seed (`20260520171804_seed_globals`) is the precedent.

**Vitest 4 removed `it(name, fn, options)`.** Use `it(name, options, fn)` — the options object goes before the function. Vitest 4.1+ throws "Signature ... was deprecated in Vitest 3 and removed in Vitest 4" if you get the order wrong. Pattern set in `rate-limited-geocoder.test.ts` (Slice 6).

**Ollama provider deliberately bypassed.** The canonical `ollama-ai-provider-v2` peers on `zod ^4` while the rest of the workspace is on `zod ^3`. Slice 7's `ollama-verifier.ts` hits Ollama's `/api/chat` directly via global `fetch` and uses the native `format` field (a JSON Schema object) for structured output — same end result, one less dep. If the workspace ever moves to zod 4, the Ollama provider can replace the hand-written client.

**LLM verifier swallows errors and returns null.** A provider failure (timeout, schema mismatch, model misbehavior) returns `null` — the matching pipeline treats this as "no verification opinion" and falls back to the algorithmic verdict. Routes surface `null` as 204 No Content. Don't add throwing fallback paths without thinking through the failure semantics for the matching pipeline.

**Slice 7 corrected the LLM scope.** The original spec named three LLM services (`AddressNormalizer`, `AddressMatcher`, `AddressVerifier`); only `AddressVerifier` is actually LLM-based in Rust. The other two land with Slice 8: `AddressMatcher` is pure Jaro-Winkler + substitution dictionary, `AddressNormalizer` is the libpostal HTTP sidecar (Pelias). See updated Slice 8 spec.

**The rate-limited geocoder test does wall-clock timing.** It fires 8 calls at 4 rps and asserts `elapsed >= 750ms`. Token-bucket refill timing varies a bit; if this turns out flaky in CI, widen the lower bound or split into "no-delay first burst" + "delay after burst" pairs against a tighter clock. Don't replace with fake timers — Effect 4's `RateLimiter` doesn't respect vitest's `vi.useFakeTimers`.

**Drizzle repos + write use cases have ZERO direct test coverage.** The 83 tests today cover (a) pure functions in `domain/services/`, (b) infra-service decorators with mocked fetch, (c) orchestration logic with fake repos. None of `createDrizzle*Repository`, none of the use-case `execute` methods, are exercised against a real DB. This is a deliberate gap — there's no `@testcontainers/postgresql` setup yet. Plan: backfill in a dedicated test-infra slice before Slice 12 cutover. If you're tempted to add a one-off DB test, either (a) bring testcontainers in as the canonical pattern, or (b) use the dev compose DB on 5433 with a clear note that it requires `pnpm db:up` to run.

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

# forward + reverse geocode (Photon-backed, rate-limited by default to 5 rps)
curl -s -X POST -H 'content-type: application/json' -H 'x-user-id: alice' \
  -d '{"houseNumber":"548","road":"Market Street","city":"San Francisco","state":"CA","postalCode":"94104","country":"USA"}' \
  http://localhost:3199/geocode/forward | jq

curl -s -X POST -H 'content-type: application/json' -H 'x-user-id: alice' \
  -d '{"latitude":37.7899932,"longitude":-122.4008494}' \
  http://localhost:3199/geocode/reverse | jq

# vitest suite (Slice 6 added the first tests in the codebase; Slice 7 brings the count to 40)
pnpm -F @pinpoint/server test

# verify-match (Slice 7): defaults to Noop → 204 No Content
curl -s -X POST -H 'content-type: application/json' -H 'x-user-id: alice' \
  -d '{"inputAddress":"548 Market St, SF","candidateAddress":"548 Market Street, San Francisco"}' \
  -w '\nstatus=%{http_code}\n' http://localhost:3199/verify-match

# verify-match against local Ollama: boot the server with the provider env vars
PINPOINT_LLM_PROVIDER=ollama PINPOINT_LLM_MODEL=gemma4 PORT=3199 pnpm tsx src/server.ts
# then re-run the curl above → 200 with {matchConfirmed, confidence, reasoning}

# Slice 9 validation worker — dev mode (no signing secret): unsigned POST OK
curl -s -X POST -H 'content-type: application/json' -d '{}' \
  http://localhost:3199/jobs/validate-master-locations | jq

# Slice 9 auth mode: boot with FLOWCATALYST_SIGNING_SECRET set, then sign:
TS=$(date +%s) BODY='{}' SECRET=test-secret
SIG=$(printf '%s%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl -s -X POST \
  -H 'content-type: application/json' \
  -H "X-FlowCatalyst-Timestamp: $TS" \
  -H "X-FlowCatalyst-Signature: $SIG" \
  -d "$BODY" \
  http://localhost:3199/jobs/validate-master-locations | jq
# → 200 with { attempted, confirmed, failed, failures }
```
