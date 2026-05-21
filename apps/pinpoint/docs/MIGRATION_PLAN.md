# Pinpoint TS Port — Migration Plan

Port pinpoint from Rust (`~/Developer/tangent/pinpoint`) to TypeScript as a new app in `flowcatalyst-apps`. Mirrors the `apps/fulfil/` stack and patterns end-to-end — see `apps/fulfil/CLAUDE.md` for the authoritative architectural reference.

Execution model: **vertical slices**. Each slice ends with a runnable endpoint or job.

---

## Status (2026-05-21)

**Slice 10a shipped 2026-05-21.** Path-scope rewrite — all flat routes moved under `/clients/:clientId/...` to match the Rust shape. Layer features nest as `/clients/:cid/layers/:lid/features/*`. New `docs/route-triage.md` catalogues every Rust route file + the TS port status, including the ~18 deferred CRUD ops for 10b and the 11 BFF route files for 10c.

| Slice | Status | Commit | Notes |
|---|---|---|---|
| PRE-0a | done | `6f2349c` + `c46b00e` (fixup) | framework-extraction. The fixup commit landed the in-place import retargeting that PRE-0a missed |
| PRE-0b | done | `5357bdf` | UoW infra extraction (TransactionStore, DrizzleOutboxDriver, AggregateRegistry, commitAggregate, audit_logs schema) into `@flowcatalyst-apps/app-framework` |
| 0 | done | `a588006` | scaffold + Fastify + Drizzle + `/health` + `/docs`. Migration `0001_init.sql` (PostGIS CREATE EXTENSION) **NOT** ported — deferred to Slice 5 where it's first needed |
| 1 | done | `138204d` | Principal aggregate, Country read model, `/me`, `/countries`. `principal_partitions` table deferred to Slice 2 (FK to partitions). `countries.geometry` + ~390KB seed deferred to Slice 5 |
| 2 | done | `a7e34dd` | Client + Partition aggregates + first UoW path. `principal_partitions` table joined in here. Event types declared in `flowcatalyst/events.ts` |
| 3 | done | `2d30bfc` | Location aggregate (full schema), minimal create + paged reads. **~85% of the Rust `create_location.rs` pipeline deferred** to slices 6/7/8 |
| 4 | done | `13cc964` | Layers + LayerFeatures. First `commitDelete` user. `boundary` GEOMETRY columns + GIST indexes deferred to Slice 5. PropertySet aggregate scaffolding deferred (schema only) |
| 5 | done | `dac0b43` | PostGIS canary. `MatchingConfig` aggregate + `update-matching-config`, `GET/PUT /matching-config`, `POST /spatial-lookup`. Drizzle geometry `customType` (with `codec: 'text'` opt-out around the built-in POINT-only codec), GIST indexes on `layers`/`layer_features`/`countries`, country geometry seed verbatim from Rust 016, first two Drizzle migrations generated + applied |
| 6 | done | `5323e76` | External services: Photon `GeocoderService` + Effect 4 `RateLimiter`-backed decorator, `POST /geocode/forward` + `POST /geocode/reverse`, 25 tests (first in the codebase) |
| 7 | done | `b4f6620` | LLM `AddressVerifier` — Vercel AI SDK + `@ai-sdk/amazon-bedrock` Bedrock impl, native-fetch Ollama impl (sidesteps the `ollama-ai-provider-v2`'s zod-4 peer requirement), Noop default. `POST /verify-match` debug route. Env-driven provider selection (`PINPOINT_LLM_PROVIDER`). 15 new tests; smoke against local Ollama+gemma4 green |
| 8 | done | `72b812d` + `b4981c6` | Master locations + the full matching pipeline. `MasterLocation` aggregate (PENDING/GEOCODED/VALIDATED/REJECTED), `AddressMatcher` pure module + 80-entry SUBSTITUTIONS, libpostal `AddressNormalizer` + pelias/libpostal-service sidecar, `processing_log`, rewritten `create-location` running the full Rust pipeline. `validate-master-location` (geocode) + `confirm-master-location` (canonicalize + cascade). 4 new master-location routes. End-to-end smoke green |
| schema-sync | done | `5f4685e` | Event-data interfaces → TypeBox; `scripts/sync-flowcatalyst.ts` pushes payload JSON Schemas via `addSchemaVersion`. All 12 events now carry schemas to the platform |
| 9 | done | `2726201` | FlowCatalyst-scheduled validation worker. `pinpoint-validate-master-locations` runs every 5 min, POST `/jobs/validate-master-locations` HMAC-verified, drains the GEOCODED batch. ScheduledJobDefinition in the DefinitionSet sync. 15 new tests |
| 10a | done | (this commit) | Path-scope rewrite. 19 route files moved from flat to `/clients/:clientId/...`. Layer features under `/clients/:cid/layers/:lid/features/*`. `/me`, `/countries`, `/health`, `/geocode/*`, `/verify-match`, `/jobs/*` stay flat. New `docs/route-triage.md` catalogues the full Rust surface + ports status |
| 10b | pending | — | ~18 missing CRUD use cases (Client/Partition/Layer update/delete + MasterLocation update/reject + PropertySet/Property/LocationAttribute/PrincipalPartition CRUD). Split into 2-3 commits |
| 10c | pending | — | BFF mount at `/bff/clients/:cid/...` (11 route files) + `master-locations/unvalidated` (from Rust `unvalidated_routes.rs`) |
| 11-12 | pending | — | Web lift (pinpoint-web → apps/pinpoint/web/) + cutover (Docker compose, README, OIDC) |

Chores: `3e5726f`, `a1bcb38` (tsbuildinfo + .gitignore cleanup).

**Cumulative deferrals to track across remaining slices** — see `HANDOFF.md` for the full list.

---

## Stack (matches `apps/fulfil/`)

- **Runtime**: Node 24 LTS, pnpm 11, TypeScript 6.0.3
- **HTTP**: Fastify + `@fastify/type-provider-typebox`
- **OpenAPI**: `@fastify/swagger` + `@fastify/swagger-ui` (generated from TypeBox)
- **DB**: Drizzle ORM 1.0 RC + `postgres-js` driver
- **Schemas**: TypeBox (events, route schemas), Zod (shared/domain validation)
- **Effect**: `effect@4.0.0-beta.67` (catalog-pinned, no caret)
- **Use cases**: `@flowcatalyst/sdk/effect/usecase` — `UnitOfWork`, `Sealed<E>`, `commitAggregate`, `TestUnitOfWork`
- **Outbox**: `@flowcatalyst/sdk` `OutboxManager` + `DrizzleOutboxDriver`
- **Identity**: `Scope` + `ScopeStore` (AsyncLocalStorage)
- **Fan-out**: `DispatchJobBroker` (cross-aggregate)
- **LLM**: Vercel AI SDK (`ai`@v6 + `@ai-sdk/amazon-bedrock`)
- **Scheduling**: FlowCatalyst platform scheduled jobs → webhook endpoints (not in-process croner)
- **Logging**: Pino via Fastify
- **Testing**: Vitest

## Catalog additions (`pnpm-workspace.yaml`)

- `drizzle-orm: 1.0.0-rc.1`, `drizzle-kit: 1.0.0-rc.1`
- `postgres: ^3.4.0`
- `fastify: ^5.2.0`, `@fastify/swagger`, `@fastify/swagger-ui`, `@fastify/type-provider-typebox`
- `@sinclair/typebox: ^0.34.49`
- `ai: ^6.0.0`, `@ai-sdk/amazon-bedrock`
- `zod: ^3.24.0`

## Package layout

```
apps/pinpoint/
  shared/                       # @pinpoint/shared — Zod schemas, contracts, branded IDs
  framework/                    # @pinpoint/framework — consumes @flowcatalyst-apps/app-framework
  server/                       # @pinpoint/server
    src/
      domain/                   # aggregates, repo interfaces, events, service interfaces
      infrastructure/           # Drizzle repos, UoW wiring, Vercel-AI services, geocoder client
      operations/               # use cases
      api/                      # routes, schemas, plugins, hooks
      processes/                # decider webhooks (if any cross-aggregate)
      scheduling/               # FlowCatalyst-scheduled job webhook handlers
      flowcatalyst/             # event types, subscriptions, dispatch pools, roles, scheduled jobs
      app-context.ts
      server.ts
    drizzle/                    # migrations
    scripts/sync-flowcatalyst.ts
  web/                          # Vue/Vite SPA, lifted from tangent/pinpoint/pinpoint-web
  docs/MIGRATION_PLAN.md        # this file
```

## Rust → TS mapping

| Rust pinpoint | TS pinpoint |
|---|---|
| `pinpoint-domain/entities/<x>.rs` | `server/src/domain/<subdomain>/<aggregate>/{ids,<aggregate>,state,repository,events/}.ts` |
| `pinpoint-domain/repositories/<x>_repository.rs` (trait) | `domain/<subdomain>/<aggregate>/<aggregate>.repository.ts` (interface) |
| `pinpoint-domain/usecases/<verb>_<x>.rs` | `operations/<verb>-<aggregate>/<verb>-<aggregate>.use-case.ts` |
| `pinpoint-domain/events/<x>_events.rs` | `domain/<subdomain>/events/<aggregate>-<verb-past>.event.ts` extending `BaseDomainEvent` |
| `pinpoint-domain/services/{address_matcher,address_normalizer,address_verifier,geocoder,rate_limiter}.rs` | Effect Tag interfaces in `domain/services/`; Vercel-AI / HTTP impls in `infrastructure/services/` |
| `pinpoint-domain/authorization.rs` | `PinpointPermission` const catalog + `static readonly requiredPermission` on use case classes |
| `pinpoint-infra/repositories/*` | `infrastructure/<aggregate>-repository.ts` (Drizzle) |
| `pinpoint-server/routes/*.rs` | `api/routes/<subdomain>/<aggregate>/*.route.ts` |
| `pinpoint-server/routes/bff/*` | `api/routes/bff/*` |
| `pinpoint-server/tasks/validation_worker.rs` | `scheduling/validate-master-locations/` webhook handler + FlowCatalyst scheduled job definition |
| `pinpoint-server/session.rs` | `frameworkFastifyPlugin` + `extractRequestToken` for OIDC |
| `migrations/*.sql` | `server/drizzle/*.sql` (port verbatim) |
| `rig-core` / `rig-bedrock` | `ai` + `@ai-sdk/amazon-bedrock`, hidden behind Effect Tag service interfaces |

---

## Slices

### PRE-0: Extract `@flowcatalyst-apps/app-framework` — **DONE** (`6f2349c` + `c46b00e` + `5357bdf`)

Promote shared app infra out of `@fulfil/framework` into a new monorepo package so fulfil and pinpoint both consume it.

**Landed as PRE-0a (Scope/jobs/logging) + fixup + PRE-0b (UoW infra).** PRE-0a's first commit shipped the moved files + new package but missed the retargeted internal imports in the files that stayed in fulfil/framework — the fixup commit landed those. Don't squash the two locally without making sure tests still pass at the squashed revision.

**Move into `packages/app-framework`**: `Scope` (generic shape with base 5 fields + extras via generic param), `ScopeStore`, `TransactionStore`, `TransactionManager`, `DrizzleOutboxDriver`, `AggregateRegistry` (Tag + impl), `commitAggregate`, `commitDelete`, `buildOutboxManager`, `unitOfWorkLayer`, `dispatchJobBrokerLayer`, `frameworkFastifyPlugin`, `runJob`, `Scope.fromRequest` / `forScheduledTask` / `fromParentEvent`, `ScopeAwareDrizzleLogger`, `flowcatalystWebhookAuthHook`, `sendUseCaseError`, app-agnostic `metrics`.

**Keep in `@fulfil/framework`**: re-exports from app-framework + Fulfil-specific bits (`SlaTracker`, `NoticeService`, `CacheManager`, any Fulfil-specific Scope extras).

**Deliverable**: `pnpm -r typecheck && pnpm -r test` green for fulfil after extraction.

### Slice 0 — Pinpoint foundation — **DONE** (`a588006`)

**Scope adjustments applied:**
- `drizzle/0001_init.sql` (PostGIS CREATE EXTENSION) was NOT ported. Drizzle-kit owns migration generation; the first generated migration will pull `audit_logs` from app-framework. PostGIS lands in Slice 5 alongside the spatial work that needs it.
- pnpm-workspace.yaml catalog updates were NOT applied — fulfil's pattern was to keep most versions inline in each `package.json` rather than catalog-ed. Pinpoint mirrored that. Re-catalog later if duplication grows.


- `apps/pinpoint/{shared,framework,server,web,docs}` dirs
- `package.json` + `tsconfig.json` per sub-package (mirror fulfil)
- `vitest.config.ts` (server, shared)
- `drizzle.config.ts` (server)
- `@pinpoint/shared` initial layout
- `@pinpoint/framework` consuming `@flowcatalyst-apps/app-framework`
- `@pinpoint/server`:
  - `infrastructure/db.ts` — Drizzle + postgres-js
  - `infrastructure/{unit-of-work,outbox-driver,transaction,transaction-store,aggregate-registry,schema}.ts`
  - `api/plugins/error-mapper.ts`
  - `server.ts` — Fastify bootstrap, framework plugin, swagger, health endpoint
  - `app-context.ts` — `AppContext` type, `runWrite`, `runRead`, `useCases` placeholder
  - `flowcatalyst/{events,subscriptions,dispatch-pools,roles,scheduled-jobs,index}.ts` — empty exports + `buildPinpointDefinitions`
  - `scripts/sync-flowcatalyst.ts`
  - `PinpointPermission` const catalog skeleton
  - `drizzle/0001_init.sql` (port from Rust `migrations/001_init.sql`)
- Catalog updates in root `pnpm-workspace.yaml`
- **Smoke**: `pnpm -F @pinpoint/server dev` boots, `GET /health` returns 200, `/docs` renders empty OpenAPI

### Slice 1 — Reference data + auth — **DONE** (`138204d`)

**Scope adjustments applied:**
- `principal_partitions` table deferred to Slice 2 — it FK-references `partitions` which doesn't exist until then.
- `countries.geometry` column + GIST index deferred to Slice 5 (PostGIS canary).
- ~390KB country seed (016) deferred to Slice 5; `/countries` returns empty until seeded.
- Real OIDC deferred; `extractRequestToken` in `server.ts` honours `x-user-id` header as dev fallback (TODO marker in place).
- `/me` upserts on read in dev mode (so `x-user-id: alice` works end-to-end without a separate provisioning step). Real OIDC slice will move the upsert into the callback.


Migrations: `006_principals.sql`, `015_countries.sql`, `016_countries_seed.sql`

- Domain: `Country` (read-only value), `Principal` aggregate
- Repos: `CountryRepository` (read-only), `PrincipalRepository`
- Auth: `frameworkFastifyPlugin` with OIDC extractor; dev fallback to `x-user-id` header (TODO real auth later)
- Routes: `GET /countries`, `GET /me`
- Permissions: `pinpoint:auth:principal:read`
- **Deliverable**: authenticated request resolves a Principal; countries listable

### Slice 2 — Tenancy spine (Clients + Partitions) — **DONE** (`a7e34dd`)

**Scope adjustments applied:**
- `principal_partitions` table from Slice 1 deferral was joined here (schema only — no API surface yet; future authz slice will expose grant/revoke).
- ID prefixes registered: `cli` → Client, `par` → Partition. Use these going forward for IDs of these aggregates.
- First UoW path validated. `commitAggregate(aggregate, event, command)` compiles cleanly; `Sealed<E>` guarantee holds.


Migrations: `002_clients_partitions.sql`, `007_partition_code.sql`

- Aggregates: `Client`, `Partition`
- Use cases: `create-client`, `create-partition`
- Events: `client-created`, `partition-created`
- Routes: `POST/GET /clients`, `POST/GET /partitions`
- Permissions: `pinpoint:tenancy:{client,partition}:{create,read}`
- **Deliverable**: tenancy parents creatable; events emit via outbox

### Slice 3 — Locations core — **DONE** (`2d30bfc`)

**Scope adjustments applied — significant:**
- The Rust `create_location.rs` (~600 lines: libpostal normalization → hash + pg_trgm fuzzy candidate search → LLM verification → master_location association → layer feature spatial lookup → processing-log appending → LocationValidated emission) was **NOT** ported. Only the "minimal PENDING create" subset landed. The full pipeline splits across slices 5 (PostGIS + fuzzy), 7 (LLM services), and 8 (master locations + LocationValidated).
- `master_locations` table deferred to Slice 8. `locations.master_location_id` is a nullable text column today with **NO FK reference**. Slice 8 adds both the table and the FK in one migration.
- `processing_log` table deferred to Slice 8.
- `location_attributes` table shipped (schema only — no domain types, no use cases). Attribute CRUD comes with Location update use cases in a later slice.
- `PropertySet` aggregate from the original plan moved to **Slice 4** — it belongs to layers (Rust `pinpoint-domain/src/entities/property_set.rs` references `layer_id`), not locations.
- Get/list operations are **direct repository calls from routes**, not use cases. Mirrors fulfil's pattern (use cases = writes only; reads bypass UoW). The original plan listed three use cases for Slice 3; only `create-location` is a use case.
- ID prefix registered: `loc` → Location. `mlo` reserved for master locations (Slice 8) but not yet registered.


Migrations: `004_locations.sql`, `008_location_indexes.sql`, `014_suburb_and_processing_log.sql`

- Aggregates: `Location`, `LocationAttribute`, `PropertySet`
- Use cases: `create-location`, `get-location`, `list-locations`
- Events: `location-created`
- Routes: `POST /locations`, `GET /locations/:id`, `GET /locations` (paged)
- **Deliverable**: flagship CRUD slice validating UoW + outbox + paged reads

### Slice 4 — Layers + layer features — **DONE** (this commit)

**Scope adjustments applied:**
- `boundary GEOMETRY(Geometry, 4326)` columns + GIST indexes on `layers` and `layer_features` deferred to Slice 5 (PostGIS canary), mirroring the Slice 1 `countries.geometry` deferral. Scalar lat/lon/radius/polygon_geojson all ship in Slice 4.
- Migration 013's second ALTER (`location_feature_associations.distance_meters`) deferred to Slice 5 — the table it modifies doesn't exist until then. Slice 4 ported only the `layer_features.status` ALTER from 013.
- `PropertySet` aggregate scaffolding NOT added: there's no Rust use case for direct property-set management, and Slice 3 set the precedent of "schema-only until a use case needs it" (cf. `location_attributes`). `property_sets` and `properties` tables ship; ID prefix `pst` reserved but unregistered.
- `location_layer_associations` table ported as schema-only — populated by the matching pipeline (Slice 5+). FK targets (locations, layers) both exist now, so the table compiles cleanly.
- `layer_partitions` table ported but unpopulated — no `assign-layer-to-partition` use case yet (later slice).
- ID prefixes registered: `lyr` → Layer, `lfe` → LayerFeature. PropertySet (`pst`) reserved.
- First `commitDelete` consumer (`delete-layer-feature`) validated the deletion-through-UoW path end-to-end.


Migrations: `005_layers.sql`, `009_layer_features.sql`, `010_layer_code.sql`, `013_feature_status_and_point_type.sql` (partial), `017_layer_partitions.sql`

- Aggregates: `Layer`, `LayerFeature`
- Use cases: `create-layer`, `create-layer-feature`, `update-layer-feature`, `delete-layer-feature`
- Events: `layer-created`, `layer-feature-{created,updated,deleted}`
- Routes: `POST /layers`, `GET /layers/:id`, paged `GET /layers?clientId=…`, `POST/PUT/DELETE /layer-features/...`, `GET /layer-features/:id`, paged `GET /layer-features?layerId=…`
- **Deliverable**: layer management complete

### Slice 5 — Matching config + spatial lookup (PostGIS canary) — **DONE** (this commit)

**Scope adjustments applied:**
- `pg_trgm` extension was installed (via `pnpm db:init`) but the trgm indexes from Rust migration 012 were **NOT** ported — they all reference `master_locations` which doesn't exist until Slice 8. Trgm indexes move to Slice 8.
- The boundary backfill UPDATEs from Rust migration 011 (`UPDATE layers SET boundary = ST_Buffer(...)`) were NOT ported as a Drizzle migration — they're only meaningful against rows that were created BEFORE the boundary column existed, and pinpoint has no such rows (it's a fresh DB). Documented as a manual one-liner in `docs/spatial-queries.md` if it ever needs running.
- `master_locations.point` backfill (also in Rust 011) — deferred to Slice 8 alongside the table.
- Drizzle geometry customType required `codec: 'text'` to opt out of Drizzle 1.0's built-in POINT-only geometry codec. Without it, every read against a table holding a non-POINT boundary blows up with `Unsupported geometry type` — see `docs/spatial-queries.md` and HANDOFF gotchas.
- Seeds (`mcf_GLOBAL_DEFAULT` matching config + country geometries) ship as a `drizzle-kit generate --custom` migration (`20260520171804_seed_globals`), with `ON CONFLICT (id) DO NOTHING` per INSERT so the migration is safe to re-apply against a partially-seeded DB.
- ID prefix registered: `mcf` → MatchingConfig. Fixed-id seed row `mcf_GLOBAL_DEFAULT` is the bottom of the (client, partition) → (client, NULL) → (NULL, NULL) cascade.


Migrations: `003_matching_config.sql`, `011_spatial_matching.sql` (partial — boundary columns + `location_feature_associations` table only), `015_countries.sql` (geometry column added), `016_countries_seed.sql` (verbatim).

- Aggregates: `MatchingConfig`
- Use cases: `update-matching-config` (lazy-promotes scoped row from global default + applies threshold overrides; deletion deferred — no Rust use case)
- Events: `matching-config-updated`
- Spatial: Drizzle `customType` for geometry columns (with `codec: 'text'` opt-out); raw `sql\`...\`` for `ST_Intersects` / `ST_Distance` predicates; reads of the column always project via `ST_AsText`/`ST_AsGeoJSON`.
- Routes: `GET /matching-config`, `PUT /matching-config`, `POST /spatial-lookup`
- **Deliverable**: spatial lookups end-to-end; pattern documented in `docs/spatial-queries.md`

### Slice 6 — External services + rate limiter — **DONE** (this commit)

**Scope adjustments applied:**
- Geocoder is a plain async interface (`GeocoderService`), not an Effect Tag — matches the repository pattern. Composed at the AppContext composition root and read via `appContext.services.geocoder`.
- Provider confirmed from Rust: **Photon** (`https://photon.komoot.io`), the same OSM/Komoot search service the Rust pinpoint uses. The TS impl is a byte-for-byte port of `geocoding_client.rs` — same query construction order, same User-Agent default, same confidence weights (0.20 + 0.25 + 0.25 + 0.20 + 0.10), same error message strings. Self-hosted Photon configurable via `PINPOINT_GEOCODING_API_URL`.
- Rate limiter is the Effect 4 `RateLimiter` from `effect/unstable/persistence` (token-bucket, `onExceeded: 'delay'`). The store layer is `RateLimiter.layerStoreMemory` today; swapping to a Redis store is a one-line layer change later. The `governor` port path was skipped — Effect 4's built-in primitive gives us the same semantics for less code.
- Decorator pattern: `createRateLimitedGeocoder(inner, config)` wraps any `GeocoderService`. Consumers always get a throttled instance from the composition root.
- Two routes ship instead of one: `POST /geocode/forward` and `POST /geocode/reverse`. The Rust pinpoint doesn't expose forward geocoding via API (it's only called internally), but the TS port adds it as a Slice 6 affordance so the integration can be exercised end-to-end before the master-locations slice wires it into `create-location`.
- `NormalizedAddress` data type lands here (the input shape for forward + the output shape for reverse). The full `AddressNormalizer` service Tag (with libpostal-style normalization) stays deferred to Slice 7 alongside the LLM services.
- First tests in the codebase: 25 vitest tests across `photon-geocoder.test.ts` (fetch mocking via `vi.spyOn(globalThis, 'fetch')`), `rate-limited-geocoder.test.ts` (pass-through + wall-clock rate-limit assertion), and `address-normalizer.test.ts` (`toAddressLine` stability, the trigram index key).
- Vitest 4 gotcha: the legacy `it(name, fn, options)` signature was removed; use `it(name, options, fn)` instead.
- Wiring `POST /spatial-lookup` into `create-location` deferred — noted in HANDOFF, lands with the master-locations slice (or geocoder-driven enrichment, whichever comes first).


- Tag: `GeocoderService` (plain async interface, not an Effect Tag)
- Infra: Photon-backed HTTP client via Node 24 global `fetch`; rate-limited decorator via Effect 4's `RateLimiter` primitive
- Routes: `POST /geocode/forward`, `POST /geocode/reverse`
- **Deliverable**: external geocoding callable + rate-limited; 25 tests + live smoke against `photon.komoot.io` both green

### Slice 7 — LLM address verifier — **DONE** (this commit)

**Scope adjustments applied — significant:**
- Original spec named "three LLM services: AddressNormalizer, AddressMatcher, AddressVerifier". Reading the Rust source proved this wrong: **only `AddressVerifier` is LLM-based**. `AddressNormalizer` is libpostal-HTTP-sidecar-based (`LibPostalNormalizer`); `AddressMatcher` is a pure Jaro-Winkler + substitution-dictionary algorithm. Both belong with Slice 8's master-locations work where they're actually called from.
- Three impls of `AddressVerifier` shipped, matching the Rust trifecta verbatim: `BedrockVerifier` (default model `anthropic.claude-3-haiku-20240307-v1:0`), `OllamaVerifier` (default model `gemma3`, default URL `http://localhost:11434`), `NoopVerifier` (default provider — verification is optional in the matching pipeline).
- **Ollama provider**: skipped the canonical `ollama-ai-provider-v2` package — its peer wants `zod ^4` and the whole monorepo is on `zod ^3.24`. Bumping the workspace to zod 4 is a wider piece of work than Slice 7 should drag in. Instead the Ollama verifier hits `/api/chat` directly via global `fetch` and uses Ollama's native `format` field (a JSON Schema object) for structured output. End result is identical; one less dep.
- **Bedrock provider**: uses Vercel AI SDK's `generateObject` with the canonical Zod schema for `VerificationResult`. Required a minor zod bump in `apps/pinpoint/server` from `^3.24.0` to `^3.25.76` (the AI SDK + Bedrock peer floor). The rest of the workspace stays on `^3.24.0`.
- **Error handling matches Rust**: a verifier failure (provider down, schema mismatch, network error) returns `null` rather than throwing. The route surfaces this as 204 No Content. The matching pipeline must treat `null` as "no verification opinion" — the algorithmic verdict stands.
- **Debug route**: `POST /verify-match` ships even though the Rust pinpoint doesn't expose verification via HTTP. Same affordance pattern as Slice 6's `/geocode/forward`: lets prompt tuning happen end-to-end before Slice 8 wires verification into the master-locations flow.
- **Decision point passes**: with gemma4 8B Q4 local, the three smoke addresses (same / different house numbers / different cities) returned `match_confirmed` matching expectation with reasoning that literally echoed the system-prompt heuristics. No rig-core regression observed.
- **Tests**: 15 new vitest tests across `ollama-verifier.test.ts` (mock fetch + format-field verification + error-fallback paths), `noop-verifier.test.ts`, and `address-verifier.test.ts` (prompt-builder + Zod schema stability — the prompt rides into the LLM verbatim, so changes need to be deliberate).


- Service: `AddressVerifier` (plain async interface, not an Effect Tag — matches `GeocoderService` pattern)
- Infra: `BedrockVerifier`, `OllamaVerifier`, `NoopVerifier`
- Routes: `POST /verify-match` (debug)
- Env: `PINPOINT_LLM_PROVIDER` (none / bedrock / ollama), `PINPOINT_LLM_MODEL`, `PINPOINT_OLLAMA_URL`, `AWS_REGION`
- **Deliverable**: LLM verifier callable end-to-end against local Ollama; tests green; Bedrock impl present but not smoke-tested (no credentials path here)

### Slice 8 — Master locations + matching pipeline — **DONE** (this commit)

**Scope adjustments applied:**
- libpostal: added pelias/libpostal-service to `compose.yaml` (matches Rust verbatim). ~3GB image but the parsing/expand wire shape is identical so TS + Rust hashes collide for the same input. Env: `PINPOINT_LIBPOSTAL_URL` (defaults to `http://localhost:4400`).
- `AddressMatcher`: pure module, no service Tag — `findMatch(input, hash, candidates, thresholds)`. Takes a narrow `MatchThresholds` interface rather than the full `MatchingConfig` aggregate, so tests + future call sites can pass a bare threshold record. Jaro-Winkler is hand-ported (no external dep).
- `create-location` command shape changed from Slice 3's structured raw_* fields to the Rust shape: a free-form `address` string + optional ISO-A3 `countryCode` retry hint. The libpostal sidecar parses the address inside the use case; raw_* columns get filled from the parsed components.
- `processing_log` entries don't land on the no-match path — same as Rust. The append fires BEFORE the master commits, so the FK fails (silently — both Rust and TS swallow the error). The pipeline still works correctly; the log table just won't show entries for new masters. Fix path: have `ProcessingLogRepository.append` resolve `TransactionStore` for the bound tx; deferred.
- `LocationCreatedData` event grew a `masterLocationId` field — the new pipeline always has one (existing match OR fresh creation), so downstream consumers don't need to refetch.
- Geometry-write gotcha: when latitude/longitude are NULL (PENDING masters), the embedded `${value}` parameters are uninferrable; the repo branches to `NULL::geometry` instead of `CASE WHEN ... END`. Pre-cast on both branches when writing PostGIS columns under a conditional — Postgres rejects untyped NULLs in those positions.
- `POST /spatial-lookup` wired into `create-location`'s match path: when matched master is VALIDATED, the spatial lookup runs at the master's coords + `location_feature_associations` get written + a LocationValidated event emits alongside the LocationCreated. Same shape as the confirm-cascade.


Migrations: one Drizzle migration adds `master_locations` (with `point GEOMETRY(Point, 4326)` + GIST + trgm GIN on `normalized_address_line`), `processing_log`, `raw_suburb`/`normalized_suburb` on `locations`, and the deferred `locations.master_location_id` FK to `master_locations(id)`.

- Aggregates: `MasterLocation` (PENDING/GEOCODED/VALIDATED/REJECTED)
- Algorithm (no Tag): `AddressMatcher` — Jaro-Winkler + 80-entry SUBSTITUTIONS table verbatim from Rust
- Service: `AddressNormalizer` — `LibPostalNormalizer` (HTTP client for the pelias/libpostal-service sidecar in compose.yaml)
- Use cases: `confirm-master-location` (canonicalize + cascade), `validate-master-location` (geocode via Photon), rewritten `create-location` (full Rust pipeline)
- Events: `master-location-{created,geocoded,validated}`, `LocationValidated`
- Routes: `POST /master-locations/:id/validate`, `POST /master-locations/:id/confirm`, `GET /master-locations/:id`, paged `GET /master-locations?clientId=…`
- **Deliverable**: end-to-end matching pipeline runnable. Full smoke green: PENDING → GEOCODED → VALIDATED with EXACT_HASH dedup on repeat addresses.

### Slice 9 — Validation worker (FlowCatalyst-scheduled job) — **DONE** (this commit)

**Scope adjustments applied:**
- The original spec mentioned a separate `validate-pending-master-locations` batch use case. The TS port skips that — the existing Slice 8 `confirm-master-location` is called per master inside the batch loop. Less code, same end result, the existing use case already enforces the GEOCODED → VALIDATED transition with all its checks.
- Per-master error containment: each `confirm-master-location` runs in its own `runWrite` tx via the same loop. A `Result.failure` or thrown infra error is recorded in `failures` but doesn't abort the batch. Matches what a Rust `tokio::spawn` per-task pattern would give but stays sequential — the spatial-lookup + cascade per confirm is read-heavy + outbox-write-bound, so parallelism is unlikely to win and would contend on shared rows.
- Scheduled jobs ride in the **DefinitionSet** sync now (the SDK gained `set.scheduledJobs` between Slice 0 and Slice 9). The Slice 0 comment in `scheduled-jobs.ts` saying they're "registered via the runtime resource API" is out of date; updated.
- HMAC verification: ported `flowcatalystWebhookAuthHook` from fulfil verbatim (with the package paths adjusted). It's not yet in `@flowcatalyst-apps/app-framework` — tracked as a follow-up refactor.
- `SystemIdentity` is pinpoint-local (`pinpoint:system:scheduler`) — mirrors fulfil's `SystemIdentity` but namespaced to pinpoint so audit / outbox rows are unambiguous about which app emitted them.
- The batch handler is NOT a use case (no `Sealed<E>` return). It's a plain async orchestrator that calls the existing use case per-master. The platform-facing route returns the aggregate summary; the SDK doesn't require a sealed-event signature for webhook responses.


- Code: `pinpoint-validate-master-locations`, schedule `*/5 * * * *`, target `${publicBaseUrl}/jobs/validate-master-locations`.
- ScheduledJobDefinition fields: `concurrent: false`, `tracksCompletion: false`, `timeoutSeconds: 240`, `deliveryMaxAttempts: 3`.
- Env: `FLOWCATALYST_SIGNING_SECRET` (required for prod; unset = dev-mode bypass with per-request warning).
- Tests: 9 HMAC paths (header presence, timestamp window, signature mismatch, length mismatch, custom tolerance) + 6 batch orchestration paths (empty queue, happy path drain, per-master `Result.failure`, per-master thrown infra error, batch-size threading). 83 tests passing total.
- **Deliverable**: platform-driven scheduled validation runnable end-to-end against the dev stack.

### Slice 10 — BFF + fragments + unvalidated

- `routes/bff/partitions` — UI partition listing
- `routes/bff/principal_partitions` — user's memberships
- `routes/bff/spatial_lookup` — consolidate with slice 5
- `fragment_routes` — investigate intent; likely deletable once Vue SPA owns the UI
- `unvalidated_routes` — investigate; identify public endpoints, document why
- **Deliverable**: UI-shaped endpoints; legacy routes triaged

### Slice 11 — Web lift

- Copy `~/Developer/tangent/pinpoint/pinpoint-web/` → `apps/pinpoint/web/`
- Rename `package.json` → `@pinpoint/web`
- Retarget API base URL to local pinpoint server
- Smoke: `pnpm -F @pinpoint/web dev`
- **Deliverable**: web app served, talks to local pinpoint server

### Slice 12 — Cutover

- Docker Compose (postgres + pinpoint server + web)
- `.env.example`
- Migration parity check: diff Rust schema vs Drizzle schema
- Smoke tests across main routes
- Dockerfile (reuse fulfil's pattern)
- README updates
- **Deliverable**: deployable + documented

---

## Cross-cutting

**Outbox / UoW / Sealed** — every write use case returns `Effect.Effect<Sealed<E>, UseCaseError, UnitOfWork | AggregateRegistry [| DispatchJobBroker]>`. Routes call `appContext.runWrite(useCase.execute(command), scope)`. Bypassing UoW = compile error via `Sealed<E>` brand.

**Identity** — `Scope` from `ScopeStore` (ALS). HTTP requests via framework plugin OIDC extractor; scheduled job webhooks via `Scope.fromParentEvent`; in-process scheduled work (none currently planned) via `runJob`.

**Errors** — `Data.TaggedError` per failure. `UseCaseError` union: `ValidationError | NotFoundError | BusinessRuleViolation | ConcurrencyError | AuthorizationError | InfrastructureError`. HTTP mapping via `httpStatus(error)` at the route boundary.

**Observability** — Pino via Fastify; `correlationId`/`executionId`/`principalId` attached to every log.

**Testing** — Use cases: `TestUnitOfWork.layer(buffer)` + fake `AggregateRegistry` + `ScopeStore.run`. Routes: Fastify `inject()`. Repos: Testcontainers Postgres for slices with non-trivial queries; in-memory fakes elsewhere.

## Known risks

1. **PostGIS in Drizzle 1.0** — no native geometry types; use `customType` + raw `sql` tag. Slice 5 surfaces.
2. **`rig-core` → Vercel AI SDK prompt translation** — rig has its own conventions; prompts may need rework. Slice 7 surfaces. NOTE: rig is genuinely capable for focused use; don't underestimate it when deciding whether the port is worth it.
3. **Outbox + Drizzle 1.0 RC transaction context** — fulfil validates the pattern; confirm `DrizzleOutboxDriver` reads tx from `TransactionStore` correctly under pinpoint's flows.
4. **OIDC integration** — pinpoint will need real auth before production; out of scope until cutover.
5. **`fragment_routes.rs` / `unvalidated_routes.rs` intent** — investigate at slice 10; may be deletable.
6. **libpostal binding** — no first-class TS binding for libpostal. Slice 5/7 needs to decide between (a) hosted normalization service, (b) FFI binding via N-API, (c) accepting reduced normalization quality. The Rust version uses native libpostal directly.

## Lessons learned (slices 0-4)

Things future slices should benefit from:

- **`as never` cast on Scope in event constructors is correct.** The SDK's `BaseDomainEvent` expects a structurally-narrower `ExecutionContext`; pinpoint's `Scope` is a structural superset. The cast satisfies the brand. Don't "fix" it.
- **Fastify route response schemas must declare every status code the handler emits.** Fastify + TypeBox typechecks reply codes against the schema's `response` keys. Standard `ErrorResponseSchema` is in `tenancy/clients/create-client.route.ts` and `locations/create-location.route.ts` — reuse it.
- **`import type { sync } from '@flowcatalyst/sdk'` for namespace types only.** Value imports of the SDK namespace previously tripped an ESM-extension issue (since fixed via NodeNext switch, but `import type` is still the lighter choice when only types are needed).
- **pnpm caches `file:`-linked packages aggressively.** After rebuilding the SDK, `pnpm install --force` says "Already up to date" and lies. Use `rm -rf node_modules && pnpm install` to actually refresh.
- **DB-touching paths typecheck without a live database.** `postgres-js` connects lazily on first query. Smoke tests for `/health`, `/docs`, schema validation, and unauth/no-auth paths all work without a DB. The DB only matters for actual CRUD.
- **No drizzle migrations have been generated yet.** When you're ready to exercise the full path, `pnpm -F @pinpoint/server db:generate` against a live PG produces the first migration including `audit_logs` (from app-framework) + all the slice 1-3 tables. PostGIS extension needs a manual migration before that one.
- **The SDK's `sync.DefinitionSet` requires `applicationCode`.** Pinpoint's is `'pinpoint'`, set in `flowcatalyst/index.ts`.
- **Scheduled jobs are NOT part of `sync.DefinitionSet`.** The SDK manages them via the runtime resource API (`CreateScheduledJobRequest`). Slice 9 will create the first one.

## References

- Rust source: `~/Developer/tangent/pinpoint`
- Canonical TS pattern: `apps/fulfil/CLAUDE.md`
- SDK source: `~/Developer/flowcatalyst-rust/clients/typescript-sdk`
- Active pickup state: `apps/pinpoint/docs/HANDOFF.md`
