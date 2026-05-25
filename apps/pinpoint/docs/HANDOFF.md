# Pinpoint Port — Handoff

**Read this first if you're picking up the pinpoint port in a new session.**

## Status (2026-05-25 — post-slice-14)

- **HEAD:** `65348da` (post-Slice 14b doc update) — pinpoint fully off Effect onto plain async/await + the SDK's non-Effect sealed `Result<T>` surface. Migration plan complete; remaining work is purely deploy-time configuration.
- **Slices done:** 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10a, 10b.1, 10b.2, 10b.3, 10c (all sub-slices + hygiene), 11, 12.1, 12.2 (+ perms wiring + session refresh + live-IdP test), 12.3 (harness + 12.3a/b/c/d/e), 13 (later superseded by 14), 14 (off Effect) + PRE-0a + PRE-0b + schema-sync + cutover hardening (persistent sessions + parity check + fulfil perms)
- **Slices remaining:** none. Migration plan is functionally complete. Only deploy-time work left: real IdP credentials, production env wiring, hosting infra.
- **Workspaces:** 13 (added `@pinpoint/web` in 11), all `pnpm -r typecheck` clean
- **Tests:** 90 unit (`pnpm test`) + 116 integration across 37 files (`pnpm test:integration`, needs Docker — Postgres + Redis testcontainers)
- **Drizzle migrations:** three generated, applied (schema + countries/global-default seed + 10c flashy_ricochet) — see `apps/pinpoint/server/drizzle/`
- **Local dev:** `pnpm db:up && pnpm db:init && pnpm db:migrate` brings up a fresh PostGIS-enabled DB on port 5433 + the pelias/libpostal-service sidecar (Slice 8 wired into `apps/pinpoint/compose.yaml`). Production: `docker compose -f apps/pinpoint/compose.prod.yaml up --build` from the repo root brings up the full stack.

## Decision factors

All in-flight decision points (Slice 4 → 5 → 7 named re-checks) passed on 2026-05-20/21. The Vercel AI SDK / Ollama gemma4 path produced clean structured output with the Rust-ported prompts — no rig-core regression. The Slice 8 matching pipeline matches the Rust pinpoint's behavior end-to-end (PENDING → GEOCODED → VALIDATED with EXACT_HASH dedup on resubmission). The port is now functionally caught up.

Re-evaluate again only if:
- The BFF surface in Slice 10c turns out to be much heavier than the ~2530 LoC route-triage suggests

Original decision factors (kept for posterity / future re-checks):
- Supply chain: Rust meaningfully stronger (fewer deps, less npm churn, no beta lock-in)
- Safety: Rust stronger overall; the SDK's sealed `Result<T>` closes the "domain event must dispatch" gap at the type level
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
| 10c.1 | `ca7cbc2` | BFF dashboard + countries + clients (list + detail). New `api/routes/bff/` tree. `ClientRepository.count()` added for the dashboard. |
| 10c.2 | `4cb02e0` | BFF partitions (CRUD) + principal-partitions (list / grant / revoke). Exercises the 10b.3 repo methods. |
| 10c.3 | `e2b4ea5` | BFF locations (list/detail/create) + spatial-lookup (with `partitionCode` resolution) + `GET /master-locations/unvalidated` (cross-client). Added repo methods: `LayerFeatureRepository.findFeatureAssociations`, `MasterLocationRepository.findUnvalidated`. |
| 10c.4 | `8cb58bb` | BFF layers (CRUD + partitions + property-sets) + layer-features (CRUD + status flip). 17 routes. Added repo methods: `LayerRepository.findPartitionIds` / `setPartitionIds`, `PropertySetRepository.countByLayerIds`, `LayerFeatureRepository.setStatus`. |
| 10c.5 | `65b17f0` | BFF master-locations (list/detail/update/validate/geocode/reverse-geocode/processing-log) + matching-config (GET/PUT). `ListMasterLocationsQuery` grew an optional `status` filter. Closes 10c — full BFF surface (~40 routes, 11 mount points) in place. |
| 12.2 perms | `6649ef0` | Real permission checks across all 22 use cases. `Scope.permissions: ReadonlySet<string>` is now required; `extractRequestToken` populates it from `claims.roles` via new `auth/role-permissions.ts` (admin/operator/viewer wired today). Dev fallback + `SystemIdentity.SCHEDULER` carry ALL permissions. Each use case's `authorize(scope)` now returns `scope.permissions.has(THIS.requiredPermission)`. New `authorization.use-case.test.ts` proves the gate. |
| 12.2 refresh | `ffbcd33` | In-band session refresh on expired access token. When the session-cookie path of `extractRequestToken` hits a stale token, attempt one refresh-token exchange before falling through to 401. Logic in `auth/session-refresh.ts`. Handles concurrent rotating-refresh-token race via re-read of session before refresh. 7 unit tests. |
| 12.3e | `c9b650a` | create-location + validate-master-location integration tests via new `test/integration/fetch-mock.ts` (bespoke `globalThis.fetch` router for libpostal + Photon). 7 new tests. Surfaced + fixed real bug: `locationAttributes.insertMany` was running outside the tx, breaking FK to the just-created location row. Both attribute-write sites now thread the tx via `TransactionStore.require()`. |
| fixes | `8e2fc29` | Small follow-up fixes |
| 13 | `9b5c05f` | Repo-as-Effect-Tag refactor. All 12 repos export a `Context.Service` Tag + `.layer(port)` factory in addition to the existing Promise-typed interface (kept for `AggregateRegistry`'s plain-async persist callback — SDK `UnitOfWork.commit(persist)` shape is fixed). All 22 use cases drop the constructor and per-call `Effect.tryPromise` wraps, `yield* X` the repo from the environment. Dependencies now surface in the Effect requirement type — a use case can't accidentally require a service it didn't declare. New `UseCaseRequirements` type alias keeps signatures readable. |
| 12.2 live test | `2ac69e3` | OIDC end-to-end against an in-process fake IdP (`test/integration/auth/fake-idp.ts`). Real OIDC endpoints, RS256 keypair minted per run. 7 integration tests across TokenValidator (valid / expired / wrong-aud), OidcClient (auth-code + refresh + revoked-refresh), tryRefreshSession composed. Production change: `OidcConfig.allowInsecureRequests?: boolean` for plain-HTTP test rigs; no env loader so production configs can't accidentally enable it. |
| cutover hardening | `405a5c1` | Persistent session store drivers (Redis + Postgres), Rust↔Drizzle parity report, Fulfil OIDC perms wiring. |
| 14a | `6aa92af` | Proof-of-pattern: `create-client` use case + route + integration test off Effect. New non-Effect UoW surface in `@flowcatalyst-apps/app-framework` (`createPlainUnitOfWork`, `plainCommitAggregate`, `plainCommitDelete`, `plainEmitEvent`) — same `OutboxManager` / `DrizzleOutboxDriver` / `TransactionStore` stack, no Effect wrapper. `@pinpoint/framework/plain` subpath introduced for side-by-side migration. `AppContext.runWritePlain` boundary added alongside the Effect `runWrite`. |
| 14b | `ec21ec5` | Full sweep — pinpoint fully off Effect. All 20 remaining use cases converted to constructor-injected `(uow, registry, ...repos)` returning `Promise<Result<TEvent>>`. ~50 routes use `runWrite(() => uc.execute(cmd))` + `isFailure(result)` + `result.value` + `result.error.type`. 22 integration tests + scheduling worker test converted. 12 repository files dropped their `Context.Service` Effect adapters (Promise interface stays). `@pinpoint/framework` collapsed: `/plain` subpath removed, main entry exposes the SDK non-Effect primitives + the plain UoW factories under un-prefixed names. `app-context.ts` shed `ManagedRuntime` / `Layer.mergeAll` / repo Tag layers / `UseCaseRequirements` / Effect `runWrite`. `rate-limited-geocoder` rewritten as plain token-bucket (same burst-of-N semantics). `effect` removed from `@pinpoint/server` deps and `@pinpoint/framework` dev/peer deps. All 90 unit + 116 integration tests green; Fulfil unaffected. |

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
- ~~BFF surface mount (~40 routes across 11 mount points)~~ → Slice 10c (`ca7cbc2`/`4cb02e0`/`e2b4ea5`/`8cb58bb`/`65b17f0`)
- ~~`master-locations/unvalidated` cross-client route~~ → Slice 10c.3 (`e2b4ea5`)

**Still pending (cutover-track, not migration-track):**

- **`layer_partitions` population** → assignment surface ships in 10c.4 via `PUT /bff/clients/:cid/layers/:lid/partitions`. No `assign-layer-to-partition` use case (plain repo method `setPartitionIds`, matches Rust).
- **`fragment_routes` (askama HTML)** → WILL NOT PORT. The Vue SPA owns the UI; nothing calls fragment endpoints.
- ~~BFF master-locations hygiene tail (`confirm-geocode`, `match-features` single + bulk)~~ → **shipped as 10c hygiene** (`194d447`). Two new repo methods (`MasterLocationRepository.applyConfirmedGeocode`, `LayerFeatureRepository.findFeaturesContainingPoint`) + three routes.
- ~~**Web lift**~~ → Slice 11 (shipped).
- ~~**OIDC auth + cookie sessions for BFF**~~ → Slice 12.2 (shipped) + perms wiring (`6649ef0`) + in-band session refresh (`ffbcd33`) + live-IdP end-to-end test (`2ac69e3`).
- ~~**Docker Compose for full stack (postgres + pinpoint server + web + libpostal sidecar) + Dockerfile + README**~~ → Slice 12.1 (shipped).
- ~~**Infra-repo + use-case integration tests**~~ → Slice 12.3 closed across a/b/c/d/e. All 12 Drizzle repos and all 22 write use cases now have integration coverage (`@testcontainers/postgresql`-backed). 101 integration tests across 35 files.
- ~~**Persistent session store**~~ → `PINPOINT_SESSION_DRIVER=memory|redis|postgres` (shipped 2026-05-25). Memory (default), Redis (`PINPOINT_SESSION_REDIS_URL`), and Postgres (reuses `DATABASE_URL`) drivers all live behind the same async `SessionStore` interface. 15 new integration tests across the two persistent drivers.
- ~~**Rust ↔ Drizzle migration parity check**~~ → run 2026-05-25; report at `docs/schema-parity.md`. 17/18 tables in parity; the one TS-only table (`audit_logs`) is platform-level and intentional.
- **Production cutover items** (not in the migration plan; live work to come): real IdP credentials in deployment + deploy infra.

## What the next agent needs to read

In order:
1. `apps/fulfil/CLAUDE.md` — **canonical pattern reference** for the monorepo's UoW + Sealed + Scope + processes shape. Note: fulfil keeps using Effect 4; pinpoint moved off in Slice 14. The architectural pattern is identical (sealed result, outbox UoW, ALS-bound tx, audit log inside the persist callback); only the use-case + repo call shapes differ. See "Pinpoint diverges from fulfil on the use-case shape" in the Gotchas section below for the line-by-line mapping.
2. `apps/pinpoint/docs/MIGRATION_PLAN.md` — pinpoint-specific design + slice ordering (Slice 14 description spells out the post-Effect shape with code samples)
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

## Slice 10c status (closed)

Slice 10c shipped across five sub-commits (`ca7cbc2`/`4cb02e0`/`e2b4ea5`/`8cb58bb`/`65b17f0`) plus a hygiene follow-up (`194d447`). The full BFF surface under `/bff/clients/:cid/...` is in place — ~43 routes spanning dashboard, countries, clients, partitions, principal-partitions, locations, spatial-lookup, layers, layer-features, property-sets, master-locations (incl. confirm-geocode + match-features single + bulk), matching-config — plus the cross-client `GET /master-locations/unvalidated`. Full Rust BFF parity achieved.

BFF auth is now OIDC-backed (Slice 12.2); the `x-user-id` dev fallback
stays available behind `PINPOINT_AUTH_DEV_FALLBACK=true` for local dev.

## Slice 13 status (shipped, then superseded by Slice 14)

**Historical, no longer the active pattern.** Slice 13 introduced a
repo-as-Effect-Tag refactor across all 12 repos + 22 use cases
(`9b5c05f`). Slice 14 (below) removed Effect from pinpoint entirely;
the `Context.Service` Tags + `.layer(port)` factories described here
were deleted from every repo file. The Promise-typed `*Repository`
interface is the only repo surface that remains.

The original block read:

> Repo-as-Effect-Tag refactor across all 12 repos + 22 use cases.
> Each repo file exports three things: the Promise-typed
> `XRepository` interface, a `Context.Service` Tag (`Clients`,
> `Partitions`, `Layers`, …) whose methods return `Effect<T,
> InfrastructureError>` pre-wrapped, and a static `X.layer(port)`
> factory. `createAppContext` builds the per-Tag layers and merges
> them into the baseLayer alongside UoW + DispatchJobBroker +
> AggregateRegistry; a new `UseCaseRequirements` type alias keeps
> use-case Effect signatures readable. Use cases drop constructor
> deps for repos and `yield* X` from the environment instead.

Kept here so a future archaeologist looking at `9b5c05f` understands
what landed and what later replaced it.

## Slice 14 status (shipped)

**Pinpoint off Effect onto plain async/await + the SDK's non-Effect
sealed `Result<T>` surface.** Two commits — `6aa92af` (proof-of-
pattern on `create-client`) + `ec21ec5` (full sweep).

The SDK v0.6.15 exposes a non-Effect use-case surface at
`@flowcatalyst/sdk/usecase`: sealed `Result<T>`, `UseCaseError`
factory namespace (with `.validation`/`.notFound`/`.businessRule`/
`.concurrency`/`.authorization`/`.infrastructure`), plain
`UnitOfWork` interface (`commit`/`commitAggregate`/`commitDelete`/
`emitEvent`), `OutboxUnitOfWork` class, `ExecutionContext`,
`SecuredUseCase`. Sealed-`Result<T>` enforces "success only via
`unitOfWork.commit(...)`" by requiring an internal token at the
`Result.success(token, value)` call site — the token is exported
only to UoW implementations.

`@flowcatalyst-apps/app-framework` ships a parallel non-Effect UoW
path in `unit-of-work-plain.ts` alongside the existing Effect path
(`unit-of-work.ts`). Both wrap the same `OutboxManager` /
`DrizzleOutboxDriver` / `TransactionStore` stack — only the call
shape differs. Fulfil keeps using the Effect names verbatim;
pinpoint's `@pinpoint/framework` re-exports the `plain*` factories
under un-prefixed names (`createUnitOfWork`, `commitAggregate`,
`commitDelete`, `emitEvent`, `toInfrastructureFailure`).

Use case shape (the canonical pinpoint pattern now — fulfil's
canonical pattern still uses Effect):

```ts
class CreateClientUseCase {
  static readonly requiredPermission = PinpointPermission.TenancyClientCreate;
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly clients: ClientRepository,
  ) {}
  async execute(cmd: CreateClientCommand): Promise<Result<ClientCreated>> {
    const scope = ScopeStore.require();
    if (!this.authorize(scope)) {
      return Result.failure(UseCaseError.authorization('PERMISSION_DENIED', '…'));
    }
    const existing = await this.clients.findByCode(cmd.code);
    if (existing) {
      return Result.failure(UseCaseError.businessRule('CLIENT_CODE_EXISTS', '…'));
    }
    // build aggregate + event …
    return commitAggregate(this.uow, this.registry, client, event, cmd);
  }
}
```

`appContext.runWrite(() => uc.execute(cmd))` opens a Drizzle tx,
binds it on `TransactionStore`, invokes the thunk. Business
failures (`Result.failure`) commit the (no-op) tx since nothing was
written; thrown exceptions trigger rollback. Routes do
`if (isFailure(result)) return sendUseCaseError(reply, result.error);`
then `result.value.getData()`. Test files use the same boundary
plus `isSuccess(result)` for assertions.

What got deleted in the sweep:
- The `*Service` `Context.Service` adapters from all 12 repository
  files (Promise-typed `*Repository` interface stays).
- The `ManagedRuntime`, `Layer.mergeAll`, per-repo `.layer(port)`
  calls, `repoLayer`, `baseLayer`, the Effect `runWrite`, and the
  `UseCaseRequirements` type alias from `app-context.ts`.
- The `@pinpoint/framework/plain` subpath (introduced in 14a, used
  during the sweep, collapsed in 14b — pinpoint now imports
  everything from `@pinpoint/framework`).
- The Effect 4 `RateLimiter` in `rate-limited-geocoder.ts`,
  replaced by a plain in-process token-bucket (same burst-of-N
  semantics, same tests pass).
- `effect` from `@pinpoint/server` deps and `@pinpoint/framework`
  dev/peer deps.

**Fulfil is unaffected.** `pnpm -r typecheck` clean across all 12
workspaces. Fulfil keeps importing `@flowcatalyst/sdk/effect/usecase`
+ the Effect Tag-flavoured `commitAggregate` / `commitDelete` from
app-framework directly. The non-Effect surface ships in parallel.

**This is now the canonical pinpoint pattern.** New use cases:
plain class with constructor-injected `(uow, registry, ...repos)`,
`async execute(cmd): Promise<Result<TEvent>>`,
`Result.failure(UseCaseError.x(...))` for errors,
`commitAggregate(this.uow, this.registry, agg, event, cmd)` for
the happy path. New repos: Promise-typed interface + Drizzle impl,
no Effect Tag, no `Effect.tryPromise` wraps anywhere.

## Slice 12.3 status (closed — a/b/c/d/e all shipped)

**Testcontainers-backed integration harness.** See
`docs/integration-testing.md` for the long-form. Surface:

- `test/integration/db-fixture.ts` — one PostGIS testcontainer per
  test run, mirrors `scripts/db-init.ts` (schema + postgis + pg_trgm +
  role search_path) then applies the SDK's `outbox_messages` migration
  (rewritten on the fly to fully-qualify into the `pinpoint` schema)
  and the pinpoint drizzle migrations. `cleanDb()` truncates every
  table via a single `TRUNCATE … RESTART IDENTITY CASCADE`.
- `test/integration/test-app-context.ts` — builds a real `AppContext`
  on the testcontainer DB + a `runInScope` helper that binds a
  `ScopeStore` around use-case calls. Defaults to `ALL_PERMISSIONS_SET`
  so existing tests keep passing post-perms-wiring.
- `test/integration/fetch-mock.ts` (added in 12.3e) — 100-line bespoke
  router that swaps `globalThis.fetch` in beforeAll and dispatches by
  URL pattern. Routes unhandled calls to 404 so a stray external
  request fails loudly. Used by create-location + validate-master-
  location tests; safe to extend.
- `vitest.integration.config.ts` — separate config, picks up only
  `test/integration/**/*.test.ts`, `fileParallelism: false` (one
  container shared across the run).
- Scripts: `pnpm test:integration` (slow, needs Docker), `pnpm
  test:all` (unit + integration). `pnpm test` stays unit-only.

Coverage at close: all 12 Drizzle repos, all 22 write use cases, plus
the OIDC live-IdP suite from `2ac69e3`. 101 integration tests across
35 files; ~2.5 minutes wall-clock for the full suite.

**Real bug caught by 12.3e (`c9b650a`):** `create-location`'s inline-
attribute insert was calling `locationAttributes.insertMany(attrs)`
without the tx, so the insert ran against the default connection and
the FK to the just-created (still-uncommitted) location row failed.
Both attribute-write sites now thread the tx via
`TransactionStore.require()`. Would have been a silent prod bug.

Three gotchas baked into the harness, worth knowing before you add to
it:
- **outbox_messages lives in the SDK, not pinpoint's migrations.** The
  fixture loads it via `import.meta.resolve('@flowcatalyst/sdk')` (NOT
  `require.resolve(...package.json)` — the SDK's exports map doesn't
  expose package.json) and walks two dirs up from the resolved
  `dist/index.js`. The SQL is rewritten on the fly to qualify the
  table into the `pinpoint` schema so cleanDb truncates it.
- **`outbox_messages.type` is the message-kind discriminator**
  (`EVENT` / `AUDIT_LOG` / `DISPATCH_JOB`). The CloudEvents event-type
  code lives in `payload::jsonb->>'type'`. Filter on both.
- **`createRequire` doesn't resolve ESM-only packages with `exports`
  maps.** That tripped a chunk of time in the fixture build — use
  `import.meta.resolve` for ESM-only deps. Documented in the harness
  comment.

## Cutover hardening (2026-05-25)

Three independent gap-closing changes ahead of any real deployment.

**Persistent session store.** The `SessionStore` interface is now async
(`Promise<...>` on every method except `generateId`). Three drivers
ship behind the same interface:

- `createInMemorySessionStore` — `Map<sessionId, Session>` (default;
  lost on restart, single-instance only).
- `createRedisSessionStore({ client })` — `ioredis`-backed; `size()`
  uses `SCAN MATCH <prefix>*` so a co-tenanted Redis (e.g. shared with
  cache) doesn't inflate the count.
- `createDrizzleSessionStore(db)` — Postgres-backed via a new
  `sessions` table (see migration `20260525084900_sessions_table`). The
  migration is hand-rolled (the dev compose Postgres is wedged on the
  18-volume issue documented above); the migration directory's README
  flags snapshot regeneration as a follow-up at next
  `drizzle-kit generate`.

Driver selection via `PINPOINT_SESSION_DRIVER=memory|redis|postgres`,
defaulting to `memory`. The Redis driver requires
`PINPOINT_SESSION_REDIS_URL`. Both new drivers have integration tests
against `@testcontainers/postgresql` + `@testcontainers/redis`
respectively (15 new tests; mirrored across drivers so semantic drift
between drivers is obvious).

`compose.prod.yaml` + README env-var reference updated. The lazy
`await import('ioredis')` in `buildSessionStore` means the dep isn't
exercised on memory/postgres deploys.

**Rust ↔ Drizzle schema parity check.** Read-only audit at
`docs/schema-parity.md` (2026-05-25). 17/18 tables in parity; the one
drift item (`audit_logs` present on TS, absent on Rust) is the
platform-level table that ships with `@flowcatalyst-apps/app-framework`
and is intentional. No remediation required pre-cutover.

**Fulfil OIDC perms wiring.** Mirrors pinpoint's `6649ef0` — five of
the six `TODO(auth)` stubs in fulfil are now cleared (only the
`tenant-scope.hook.ts` header-extraction TODO remains, since that's
the larger Slice-12.2-equivalent OIDC token extraction that fulfil
hasn't done yet). New `apps/fulfil/server/src/auth/role-permissions.ts`
maps roles → permissions via `DefaultRolePermissions` from
`@fulfil/shared`. Three use cases (`mark-shipment-ready`,
`create-last-mile-shipment`, `create-last-mile-fulfilment`) now check
`scope.permissions.has(THIS.requiredPermission)` via the same constructor
cast pattern pinpoint uses. Dev fallback in `extractRequestToken` grants
ALL permissions to `x-user-id` impersonators.

## OIDC hardening (perms + refresh + live-IdP test)

Three follow-ups to 12.2's baseline, all shipped post-`a1a73c1`:

**Permission checks (`6649ef0`).** `Scope.permissions:
ReadonlySet<string>` is now a required field. `RequestToken` grew an
optional `permissions?` that `Scope.fromRequest` copies into the
scope; `JobDescriptor.identity` grew the same so scheduled jobs /
process webhooks can declare what they're allowed to do. Pinpoint-
side, new `auth/role-permissions.ts` maps roles → permissions (admin
+ operator: all; viewer: `*:read` subset; unknown roles contribute
nothing). `extractRequestToken` populates the token's permissions
from `claims.roles` for JWT-bearer and session-cookie paths. Dev
fallback (`x-user-id`) and `SystemIdentity.SCHEDULER` carry ALL
permissions — matches Rust pinpoint's dev behaviour and keeps the
validation worker unblocked. Every use case's `authorize(scope)` now
returns `scope.permissions.has(THIS.requiredPermission)` (via a
`(this.constructor as unknown as { readonly requiredPermission:
string })` cast so the pattern is symmetric across all 22).

**In-band session refresh (`ffbcd33`).** When the session-cookie path
of `extractRequestToken` finds an access token that fails validation
(typically expired), `tryRefreshSession` in `auth/session-refresh.ts`
attempts one refresh-token exchange before falling through to 401.
The SPA stays logged in across token-lifetime boundaries instead of
bouncing through `/auth/login` on every expiry. Re-reads the session
from the store before refreshing so concurrent rotating-refresh-
token races don't double-refresh; preserves the existing refresh
token when the IdP omits a new one (spec allows the old one to keep
working). On any failure returns null and leaves the session
untouched — caller treats null as "no token" → 401, identical to
pre-refresh behaviour. 7 unit tests cover happy path + race + every
null branch.

**Live-IdP end-to-end (`2ac69e3`).** In-process fake OIDC IdP at
`test/integration/auth/fake-idp.ts` exposes the real OIDC endpoints
(discovery / JWKS / authorize / token / userinfo) with tokens signed
by a freshly-generated RS256 keypair per run. 7 integration tests in
`test/integration/auth/oidc-live.test.ts` exercise TokenValidator
(valid / expired / wrong-aud), OidcClient (full auth-code grant /
refresh / revoked-refresh), and tryRefreshSession composed (seeds a
session with an intentionally-invalid access token, asserts the
helper exchanged the refresh token end-to-end against /token,
persisted the new pair, and returned claims with the right viewer-
role permission set).

Production code change to support the test rig: `OidcConfig` grew
`allowInsecureRequests?: boolean` (openid-client v6 refuses non-HTTPS
issuer URLs by default — correct in production). Honoured inside
`createOidcClient` via openid-client's `execute` option on
`discovery()`. **No env loader for the flag** — production configs
can't accidentally turn it on.

## Slice 12.2 status (shipped)

**OIDC + cookie sessions for the BFF + API.** `extractRequestToken` now
resolves three paths in order — `Authorization: Bearer` (JWT validated
via the issuer's JWKS), session cookie (`pp_session`, set by
`/auth/login`), and `x-user-id` (only when
`PINPOINT_AUTH_DEV_FALLBACK=true`). The auth surface lives under
`src/auth/`:

- `auth-config.ts` — env-driven (`OIDC_ISSUER_URL`, `OIDC_AUDIENCE`,
  `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`,
  `OIDC_SCOPES`, `PINPOINT_AUTH_DEV_FALLBACK`,
  `PINPOINT_AUTH_POST_LOGIN_REDIRECT`).
- `oidc-client.ts` — thin wrapper around openid-client v6's functional
  API (`discovery` → `buildAuthorizationUrl` + `authorizationCodeGrant` +
  `refreshTokenGrant` + `fetchUserInfo`). PKCE-with-S256.
- `token-validator.ts` — JWKS-backed JWT verifier (jose's
  `createRemoteJWKSet` + `jwtVerify`). Lazy discovery so a missing IdP
  doesn't fail boot.
- `session-store.ts` — in-memory `Map<sessionId, Session>` matching the
  Rust pinpoint's shape. Carries in-flight PKCE state (created at
  /login) + the post-callback tokens + sub/name/email. Lost on restart,
  not shared across replicas — fine for single-instance prod;
  Redis/DB-backed swap is a follow-up.
- `session-cookie.ts` — `pp_session` cookie, `HttpOnly`+`SameSite=Lax`,
  `Secure` auto-flipped off for plain-HTTP local dev.

Routes mount under `/auth/`:

- `GET /auth/login` — 503 when OIDC isn't configured; otherwise stores
  PKCE verifier + state in a fresh session row, sets the cookie,
  redirects to the IdP authorize URL.
- `GET /auth/callback` — validates state, exchanges code for tokens,
  fetches userinfo (best-effort), upserts the principal, redirects to
  `PINPOINT_AUTH_POST_LOGIN_REDIRECT` (default `/`).
- `GET /auth/logout` — drops the session row, clears the cookie,
  redirects to `/auth/login` (or `/` when no IdP).
- `GET /me` — unchanged; now also works for JWT-bearer and session-cookie
  callers.

`createAppContext` is now `async` because OIDC discovery is an `await`.
`server.ts` registers `@fastify/cookie` BEFORE the onRequest hook, and
the hook is **callback-style on purpose**: calling `done` inside
`ScopeStore.run(scope, done)` binds the scope to ALS for the rest of the
request pipeline. An `async` hook returning a promise unbinds the scope
before Fastify's next handler runs — that's the trap.

`compose.prod.yaml` gained `OIDC_*` + `PINPOINT_AUTH_*` env vars (all
empty by default — must be set explicitly for real prod).

Smoke (against `pnpm -F @pinpoint/server dev` with
`PINPOINT_AUTH_DEV_FALLBACK=true`):
- `/me` without auth → 401 ✓
- `/me` with `x-user-id` → reaches principal upsert ✓ (DB-down here, but
  scope binding proven)
- `/auth/login` with no IdP → 503 ✓
- `/auth/logout` → 302 ✓

Follow-ups (now all shipped): real end-to-end OIDC against a live IdP
(`2ac69e3`); token refresh on session-cookie expiry (`ffbcd33`);
real permission checks across all 22 use cases (`6649ef0`). See the
"OIDC hardening" section below.

## Slice 12.1 status (shipped)

**Dockerization + production compose + README.** End-to-end smoke clean:
`docker compose -f apps/pinpoint/compose.prod.yaml up --build` from the
monorepo root brings up postgres+PostGIS, the pelias/libpostal sidecar,
and a single pinpoint image that serves the Vue SPA as static. `/health`
and SPA deep-links both 200.

What landed:

- `apps/pinpoint/Dockerfile` — multi-stage build (node:24-alpine + pnpm).
  Stage 1: `pnpm install --frozen-lockfile` + builds web (vite) + server
  (tsc) + workspace deps (tsc), then `pnpm deploy --prod --legacy` produces
  the runtime bundle. Stage 2: non-root `pinpoint` user, just dist +
  node_modules + drizzle migrations + web/dist.
- `apps/pinpoint/compose.prod.yaml` — full stack with healthchecks. Peers
  the dev `compose.yaml` (db+libpostal only); both use the same images so
  switching costs no GBs of layer re-pull.
- `.dockerignore` at repo root.
- `apps/pinpoint/README.md` — architecture overview, dev + prod
  workflows, full env-var reference.

Gotchas baked into the design (and the Dockerfile comments):

- **`@flowcatalyst/sdk` is a git-tagged dep.** Alpine doesn't ship `git`,
  so the build stage installs it explicitly. pnpm 11+ also blocks exotic
  (git-resolved) subdeps by default; the deploy step opts out via
  `pnpm config set block-exotic-subdeps false`.
- **Workspace deps as TS source.** `@pinpoint/framework`, `@pinpoint/shared`,
  `@flowcatalyst-apps/app-framework` historically exposed `src/*.ts`
  directly so tsx-driven dev could resolve them. Node 24's experimental
  type-stripping refuses TS in `node_modules`, which broke `node dist/server.js`.
  Fixed via a `compiled` import condition: each workspace pkg's exports
  now look like `{"types": "src", "compiled": "dist/index.js", "default":
  "src/index.ts"}`. Dev (tsx) hits `default` → src; the runtime container
  hits `compiled` → dist via `node --conditions=compiled dist/server.js`
  in the Dockerfile CMD. Fulfil's workspace pkgs got the same treatment
  for monorepo consistency, though only pinpoint dockerizes today.
- **Postgres 18+ volume mount.** The new image expects
  `/var/lib/postgresql/` (parent), not `/var/lib/postgresql/data` — its
  startup script complains and refuses to start when data lives outside
  the mount. The prod compose uses parent-mount; the dev compose still
  uses the legacy `/data` path because its existing volumes were
  initialised that way and forced re-init is more disruptive than the
  warning.

Both follow-ups closed:

- **12.2** shipped (`a1a73c1`) + perms wiring (`6649ef0`) + session
  refresh (`ffbcd33`) + live-IdP test (`2ac69e3`).
- **12.3** shipped across the harness commit + 12.3a/b/c/d/e.

## Slice 11 status (shipped)

**Vue SPA lift.** `pinpoint-web/` lifted into `apps/pinpoint/web/`. The
SPA boots clean on `pnpm -F @pinpoint/web dev` (Vite 7, HTTP 200 on `/`),
typechecks under the monorepo's TS 6 + vue-tsc 2.2 catalog.

What changed vs the Rust source:
- `package.json` adopted monorepo conventions: catalog refs for
  `typescript` / `vitest` / `@types/node`, dropped the standalone
  `oxlint`/`oxfmt` scripts (vite-plus handles fmt/lint at the root), no
  per-package `pnpm.onlyBuiltDependencies` (root workspace owns that).
- `zod` pinned to `^3.25.0` (was `^4.1.13`). The whole monorepo runs on
  zod 3; adding zod 4 caused pnpm to produce two `drizzle-orm` peer
  trees (one bound to zod 3, one to zod 4), which surfaced as cross-
  workspace nominal-type errors in `@fulfil/server`'s drizzle calls.
  `@vee-validate/zod@4` happily supports zod 3, so the downgrade is a
  no-op for the SPA.
- `PpLayerEditor.vue` emits switched from kebab-case (`"point-change"`,
  `"radius-change"`, `"polygon-change"`) to camelCase to satisfy
  vue-tsc 2.2's stricter typed-`defineEmits` checks. Template binding
  is unchanged (Vue auto-converts).

Vite dev proxies `/bff`, `/api`, `/auth` → `http://localhost:3000` to
hit the local pinpoint server. The SPA uses the BFF cookie-auth flow;
real OIDC + perms checks shipped in Slice 12.2 + `6649ef0`. For local
dev without an IdP, set `PINPOINT_AUTH_DEV_FALLBACK=true` — the
`x-user-id` header path then grants ALL permissions.

## Gotchas

**SDK is git-tag tracked, not path-linked.** As of 2026-05-20, all five workspaces that consume `@flowcatalyst/sdk` use `github:flowcatalyst/typescript-sdk#semver:>=0.6.7`. The git tag list is the resolution source (pnpm strips a leading `v` and matches against the spec); the package.json `version` field on the tag is stale and unreliable (v0.6.7 still claims 0.3.2). The previous `file:../../../flowcatalyst-rust/clients/typescript-sdk` path link was retired because it went stale silently between SDK rebuilds and required `rm -rf node_modules && pnpm install` to refresh (`pnpm install --force` lies and says "Already up to date").

**Standing rule: run `pnpm update @flowcatalyst/sdk -r` at the start of every new task** before doing anything else. The semver range floats but pnpm only re-resolves on explicit update. The dev SDK ships out-of-band, often weekly. If the update bumps the locked commit, run `pnpm -r --if-present typecheck` immediately so any SDK-induced breakage is attributed to the bump and not to whatever task you're about to start.

**Pinpoint diverges from fulfil on the use-case shape.** Fulfil still uses Effect 4 + `@flowcatalyst/sdk/effect/usecase` per `apps/fulfil/CLAUDE.md`. Pinpoint moved off Effect in Slice 14 to plain async/await + `@flowcatalyst/sdk/usecase`. When reading `apps/fulfil/CLAUDE.md` as the canonical pattern reference, mentally substitute the pinpoint equivalents: `Effect.Effect<Sealed<E>, UseCaseError, UnitOfWork | ...>` → `Promise<Result<TEvent>>`, `yield* X` → `await this.repo.x()`, `Effect.fail(new XError({...}))` → `Result.failure(UseCaseError.x(code, message, details?))`, `result.success.event` → `result.value`, `result.failure._tag === 'BusinessRuleViolation'` → `result.error.type === 'business_rule'`. UoW + outbox + audit semantics are identical; only the call shape differs.

**Pinpoint repos are Promise-typed interfaces only.** Don't reintroduce `Context.Service` Tag + `.layer(port)` adapters — Slice 14 removed them. New repository methods just go on the existing `*Repository` interface, called via `await this.repo.method(args)` from the use case. The `AggregateRegistry`'s plain-async persist callback (SDK shape, fixed) calls into the same interface, so there's no need for a second surface.

**`OidcConfig.allowInsecureRequests` is test-only.** Flag exists to let the in-process fake IdP run over plain HTTP (openid-client v6 refuses non-HTTPS issuers by default). There is **no env loader** for the flag — production configs can't accidentally turn it on. Don't add one without understanding why.

**Fake-IdP gotcha: id_token `aud` ≠ access_token `aud`.** The id_token's `aud` must be the `client_id` per OIDC spec; access tokens carry the resource audience. Conflating them makes openid-client reject the auth-code grant with `OAUTH_JWT_CLAIM_COMPARISON_FAILED`. Built into `test/integration/auth/fake-idp.ts` — preserve when extending.

**Inline-attribute insert requires the tx.** The `create-location` use case writes location attributes inline in the same UoW transaction. Both write sites resolve the tx via `TransactionStore.require()` and pass it through — without that, the insert runs against the default connection and the FK to the just-created (still-uncommitted) location row fails. Caught by Slice 12.3e's integration test (`c9b650a`). If you add another inline-child-entity write site, mirror this pattern.

**`as never` cast on Scope in event constructors.** This is intentional — the SDK's `BaseDomainEvent` expects a structurally-narrower `ExecutionContext`, and pinpoint's `Scope` is a structural superset. The cast satisfies the brand. Don't try to "fix" it without understanding the seal pattern.

**Route response schemas need all status codes.** Fastify + TypeBox typechecks reply codes against the schema's declared `response` keys. Every error status the handler can emit (400/401/403/404/409/500) must be declared in the route's `response: {…}` schema. See the tenancy/locations routes for the standard `ErrorResponseSchema`.

**`*.tsbuildinfo` is gitignored** as of `a1bcb38`. If you see it appearing as untracked, that's the typecheck cache; ignore it.

**PostGIS geometry needs `codec: 'text'` on the customType.** Drizzle 1.0 RC's built-in `geometry` codec matches by SQL type prefix and routes any `geometry(*)` column through `parseEWKB`, which only handles POINT and throws "Unsupported geometry type" on POLYGON / MULTIPOLYGON. The customType in `infrastructure/schema/types/geometry.ts` passes `codec: 'text'` to opt out. If anyone ever "cleans up" that line, every read against a layer / layer_feature / country with a real geometry blows up — including from repos that never touch the boundary column directly. See `docs/spatial-queries.md`.

**Drizzle-kit `--custom` is how seeds land.** Migration journals don't include hand-dropped `.sql` files. To add a seed, run `pnpm exec drizzle-kit generate --custom --name <slug>` — it scaffolds the file AND updates `meta/_journal.json` so `drizzle-kit migrate` picks it up. The countries seed (`20260520171804_seed_globals`) is the precedent.

**Vitest 4 removed `it(name, fn, options)`.** Use `it(name, options, fn)` — the options object goes before the function. Vitest 4.1+ throws "Signature ... was deprecated in Vitest 3 and removed in Vitest 4" if you get the order wrong. Pattern set in `rate-limited-geocoder.test.ts` (Slice 6).

**Ollama provider deliberately bypassed.** The canonical `ollama-ai-provider-v2` peers on `zod ^4` while the rest of the workspace is on `zod ^3`. Slice 7's `ollama-verifier.ts` hits Ollama's `/api/chat` directly via global `fetch` and uses the native `format` field (a JSON Schema object) for structured output — same end result, one less dep. If the workspace ever moves to zod 4, the Ollama provider can replace the hand-written client.

**LLM verifier swallows errors and returns null.** A provider failure (timeout, schema mismatch, model misbehavior) returns `null` — the matching pipeline treats this as "no verification opinion" and falls back to the algorithmic verdict. Routes surface `null` as 204 No Content. Don't add throwing fallback paths without thinking through the failure semantics for the matching pipeline.

**Slice 7 corrected the LLM scope.** The original spec named three LLM services (`AddressNormalizer`, `AddressMatcher`, `AddressVerifier`); only `AddressVerifier` is actually LLM-based in Rust. The other two land with Slice 8: `AddressMatcher` is pure Jaro-Winkler + substitution dictionary, `AddressNormalizer` is the libpostal HTTP sidecar (Pelias). See updated Slice 8 spec.

**The rate-limited geocoder test does wall-clock timing.** It fires 8 calls at 4 rps and asserts `elapsed >= 750ms`. Token-bucket refill timing varies a bit; if this turns out flaky in CI, widen the lower bound or split into "no-delay first burst" + "delay after burst" pairs against a tighter clock. The decorator is plain JS (Slice 14 rewrote it off Effect 4's `RateLimiter`); fake timers would work in principle, but the wall-clock assertion has been stable so far — don't switch unless flakiness surfaces.

**Two test surfaces, two configs.** `pnpm test` (unit, vitest) covers pure functions, decorator orchestration with fake repos, and the OIDC session-refresh helper — fast, no Docker. `pnpm test:integration` (vitest with `vitest.integration.config.ts`, `fileParallelism: false`) covers every Drizzle repo + every write use case + the OIDC live-IdP suite, all against a single `@testcontainers/postgresql` instance shared across the run. The canonical pattern post-Slice 12.3 is: if your code touches a Drizzle repo or `globalThis.fetch`, write an integration test (via testcontainer DB or `fetch-mock.ts`); otherwise a unit test with fakes is fine. Don't reintroduce DB-touching tests against the dev compose on 5433 — that path is for human smoke-testing.

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
