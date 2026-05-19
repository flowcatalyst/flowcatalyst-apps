# Pinpoint TS Port — Migration Plan

Port pinpoint from Rust (`~/Developer/tangent/pinpoint`) to TypeScript as a new app in `flowcatalyst-apps`. Mirrors the `apps/fulfil/` stack and patterns end-to-end — see `apps/fulfil/CLAUDE.md` for the authoritative architectural reference.

Execution model: **vertical slices**. Each slice ends with a runnable endpoint or job.

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

### PRE-0: Extract `@flowcatalyst-apps/app-framework`

Promote shared app infra out of `@fulfil/framework` into a new monorepo package so fulfil and pinpoint both consume it.

**Move into `packages/app-framework`**: `Scope` (generic shape with base 5 fields + extras via generic param), `ScopeStore`, `TransactionStore`, `TransactionManager`, `DrizzleOutboxDriver`, `AggregateRegistry` (Tag + impl), `commitAggregate`, `commitDelete`, `buildOutboxManager`, `unitOfWorkLayer`, `dispatchJobBrokerLayer`, `frameworkFastifyPlugin`, `runJob`, `Scope.fromRequest` / `forScheduledTask` / `fromParentEvent`, `ScopeAwareDrizzleLogger`, `flowcatalystWebhookAuthHook`, `sendUseCaseError`, app-agnostic `metrics`.

**Keep in `@fulfil/framework`**: re-exports from app-framework + Fulfil-specific bits (`SlaTracker`, `NoticeService`, `CacheManager`, any Fulfil-specific Scope extras).

**Deliverable**: `pnpm -r typecheck && pnpm -r test` green for fulfil after extraction.

### Slice 0 — Pinpoint foundation

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

### Slice 1 — Reference data + auth

Migrations: `006_principals.sql`, `015_countries.sql`, `016_countries_seed.sql`

- Domain: `Country` (read-only value), `Principal` aggregate
- Repos: `CountryRepository` (read-only), `PrincipalRepository`
- Auth: `frameworkFastifyPlugin` with OIDC extractor; dev fallback to `x-user-id` header (TODO real auth later)
- Routes: `GET /countries`, `GET /me`
- Permissions: `pinpoint:auth:principal:read`
- **Deliverable**: authenticated request resolves a Principal; countries listable

### Slice 2 — Tenancy spine (Clients + Partitions)

Migrations: `002_clients_partitions.sql`, `007_partition_code.sql`

- Aggregates: `Client`, `Partition`
- Use cases: `create-client`, `create-partition`
- Events: `client-created`, `partition-created`
- Routes: `POST/GET /clients`, `POST/GET /partitions`
- Permissions: `pinpoint:tenancy:{client,partition}:{create,read}`
- **Deliverable**: tenancy parents creatable; events emit via outbox

### Slice 3 — Locations core

Migrations: `004_locations.sql`, `008_location_indexes.sql`, `014_suburb_and_processing_log.sql`

- Aggregates: `Location`, `LocationAttribute`, `PropertySet`
- Use cases: `create-location`, `get-location`, `list-locations`
- Events: `location-created`
- Routes: `POST /locations`, `GET /locations/:id`, `GET /locations` (paged)
- **Deliverable**: flagship CRUD slice validating UoW + outbox + paged reads

### Slice 4 — Layers + layer features

Migrations: `005_layers.sql`, `009_layer_features.sql`, `010_layer_code.sql`, `013_feature_status_and_point_type.sql`, `017_layer_partitions.sql`

- Aggregates: `Layer`, `LayerFeature`
- Use cases: `create-layer`, `create/update/delete-layer-feature`
- Events: `layer-created`, `layer-feature-{created,updated,deleted}`
- Routes: `POST /layers`, `POST/PUT/DELETE /layer-features/...`
- **Deliverable**: layer management complete

### Slice 5 — Matching config + spatial lookup (PostGIS canary)

Migrations: `003_matching_config.sql`, `011_spatial_matching.sql`, `012_trgm_fuzzy_matching.sql`

- Aggregate: `MatchingConfig`
- Use cases: `update-matching-config`
- Spatial: Drizzle `customType` for WKT/WKB geometry columns; raw `sql\`...\`` for spatial predicates (`ST_DWithin`, `ST_Intersects`, `<->`)
- Routes: `PUT /matching-config`, `POST /spatial-lookup`
- **Doc**: `docs/spatial-queries.md` capturing the Drizzle + PostGIS pattern
- **Deliverable**: spatial lookups end-to-end; pattern documented

### Slice 6 — External services + rate limiter

- Tag: `Geocoder`
- Infra: HTTP geocoder client (confirm provider from Rust — Google/Mapbox/Nominatim), rate limiter (port of `governor` → Effect semaphore or `bottleneck`)
- Routes: `POST /geocode`
- **Deliverable**: external geocoding callable + rate-limited

### Slice 7 — LLM services (Vercel AI SDK)

- Tags: `AddressNormalizer`, `AddressMatcher`, `AddressVerifier`
- Infra: Bedrock impls via `@ai-sdk/amazon-bedrock` + `generateObject` with Zod output schemas
- Prompts: ported from Rust `rig-core` annotated structs
- **Deliverable**: address services callable; integration tests against Bedrock (or recorded responses)

### Slice 8 — Master locations

- Aggregate: `MasterLocation`
- Use cases: `confirm-master-location`, `validate-master-location` (uses LLM services)
- Events: `master-location-{confirmed,validated}`
- Routes: `POST /master-locations/confirm`, `POST /master-locations/validate`
- **Deliverable**: master-location workflows working

### Slice 9 — Validation worker (FlowCatalyst scheduled job)

- Add to `flowcatalyst/scheduled-jobs.ts`: `{ code: 'pinpoint-validate-master-locations', schedule: '*/5 * * * *', target: '${publicBaseUrl}/jobs/validate-master-locations' }`
- Webhook handler `POST /jobs/validate-master-locations`:
  - HMAC verification via `flowcatalystWebhookAuthHook`
  - `runJob(...)` with `SystemIdentity.SCHEDULER`
  - Calls batch use case `validate-pending-master-locations`
- Run `pnpm flowcatalyst:sync` to register
- **Deliverable**: platform-driven scheduled validation; retries/observability from platform

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
2. **`rig-core` → Vercel AI SDK prompt translation** — rig has its own conventions; prompts may need rework. Slice 7 surfaces.
3. **Outbox + Drizzle 1.0 RC transaction context** — fulfil validates the pattern; confirm `DrizzleOutboxDriver` reads tx from `TransactionStore` correctly under pinpoint's flows.
4. **OIDC integration** — pinpoint will need real auth before production; out of scope until cutover.
5. **`fragment_routes.rs` / `unvalidated_routes.rs` intent** — investigate at slice 10; may be deletable.

## References

- Rust source: `~/Developer/tangent/pinpoint`
- Canonical TS pattern: `apps/fulfil/CLAUDE.md`
- SDK source: `~/Developer/flowcatalyst-rust/clients/typescript-sdk`
