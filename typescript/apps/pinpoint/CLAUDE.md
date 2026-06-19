# Pinpoint — Spatial Geocoding + Matching Service

> Canonical architectural reference for `apps/pinpoint/`. Pinpoint **diverges** from `apps/fulfil/CLAUDE.md` on the use-case + repo call shape — pinpoint is plain async/await + the SDK's non-Effect sealed `Result<T>`, fulfil is Effect 4. UoW + outbox + audit + scope semantics are identical; only the call shape differs. When in doubt, read fulfil's CLAUDE.md for the architectural background and apply the translation in [Pattern divergences from fulfil](#pattern-divergences-from-fulfil) below.

## Project overview

TypeScript port of the Rust `pinpoint` service. Address normalization (libpostal), fuzzy candidate search (pg_trgm + Jaro-Winkler), LLM-backed verification (Vercel AI SDK + Bedrock / Ollama / Noop), Photon geocoding, master-location aggregation with PENDING/GEOCODED/VALIDATED/REJECTED lifecycle, spatial feature lookup via PostGIS. SPA frontend in `apps/pinpoint/web/` (Vue 3 + Vite). Two HTTP surfaces: the canonical `/clients/:clientId/...` API and the BFF surface under `/bff/clients/:cid/...` for the SPA.

## Technology stack

### Server

- **Runtime**: Node.js 24 LTS, pnpm 11, TypeScript 6 (strict)
- **HTTP**: Fastify + `@fastify/type-provider-typebox`
- **OpenAPI**: `@fastify/swagger` + `@fastify/swagger-ui` (generated from TypeBox, never hand-written)
- **DB**: Drizzle ORM 1.0 RC + `postgres-js` driver against PostgreSQL 18 + PostGIS
- **Schemas**: TypeBox (events, route schemas), Zod (shared/domain validation)
- **Use case primitives**: `@flowcatalyst/sdk/usecase` — sealed `Result<T>`, `UseCaseError` factory namespace (with `.validation` / `.notFound` / `.businessRule` / `.concurrency` / `.authorization` / `.infrastructure`), plain `UnitOfWork` interface (`commit` / `commitAggregate` / `commitDelete` / `emitEvent`), `OutboxUnitOfWork` class, `DomainEvent` / `BaseDomainEvent`. Re-exported through `@pinpoint/framework`.
- **No Effect.** `effect` is not a pinpoint dep. Don't reach for `Effect.gen`, `yield* Tag`, `Effect.tryPromise`, `Context.Service`, `Sealed<E>`, or tagged-error classes — those belong in fulfil.
- **Outbox**: `@flowcatalyst/sdk` `OutboxManager` + `DrizzleOutboxDriver` (ALS-aware; reads tx from `TransactionStore`)
- **Identity**: `Scope` + `ScopeStore` (AsyncLocalStorage)
- **Auth**: OIDC (`openid-client` v6) + cookie sessions + `x-user-id` dev fallback
- **External services**: Photon geocoder (HTTP), pelias/libpostal-service sidecar (HTTP), Vercel AI SDK + Amazon Bedrock / Ollama / Noop for address verification
- **Scheduling**: FlowCatalyst platform scheduled jobs → HMAC-verified webhook handlers (not in-process croner)
- **Logging**: Pino via Fastify
- **Testing**: Vitest — unit tests use fakes; integration tests use real `runWrite` + `@testcontainers/postgresql` + `@testcontainers/redis`

### Web

Vue 3 + PrimeVue + Vite. Lives at `apps/pinpoint/web/`. Dev proxy fronts `/bff` / `/api` / `/auth` at the local server.

## Project structure

```
apps/pinpoint/
├── CLAUDE.md                          # this file
├── compose.yaml                       # dev: Postgres + libpostal sidecar
├── compose.prod.yaml                  # prod: full stack
├── Dockerfile                         # multi-stage prod image
├── docs/
│   ├── MIGRATION_PLAN.md              # historical port plan + slice notes
│   ├── HANDOFF.md                     # pickup state + gotchas — read after this file
│   ├── route-triage.md                # Rust route inventory + TS port status
│   ├── schema-parity.md               # Rust ↔ Drizzle schema diff (2026-05-25)
│   ├── integration-testing.md         # testcontainers harness shape
│   └── spatial-queries.md             # PostGIS + Drizzle 1.0 RC gotchas
├── shared/                            # @pinpoint/shared — Zod schemas + contracts
├── framework/                         # @pinpoint/framework — re-exports app-framework
│   │                                  # + SDK non-Effect surface + plain UoW helpers
│   └── src/index.ts                   # single import surface for pinpoint server code
├── server/                            # @pinpoint/server
│   ├── src/
│   │   ├── domain/                    # aggregates, repo interfaces, events
│   │   ├── infrastructure/            # Drizzle repo impls, services, schema
│   │   ├── operations/                # use cases (21 of them)
│   │   ├── api/                       # routes (~91 files), plugins, hooks
│   │   ├── scheduling/                # validate-master-locations batch handler
│   │   ├── auth/                      # OIDC + session store
│   │   ├── flowcatalyst/              # event types, subscriptions, scheduled jobs
│   │   ├── app-context.ts             # composition root (this is where wiring goes)
│   │   └── server.ts                  # Fastify bootstrap
│   ├── drizzle/                       # migrations
│   ├── scripts/                       # db-init, sync-flowcatalyst
│   └── test/integration/              # testcontainers-backed integration suite
└── web/                               # Vue 3 SPA
```

## Architecture patterns

### Identity is a first-class citizen

Same as fulfil. Every execution path has an identity carried via `ScopeStore` (AsyncLocalStorage). HTTP requests populate scope through `frameworkFastifyPlugin` (OIDC or dev fallback); scheduled job webhooks populate it via `runJob(...)` with the `'pinpoint:system:scheduler'` service identity. Use cases read scope via `ScopeStore.require()`.

`Scope` is a structural superset of the SDK's `ExecutionContext` — has all five `ExecutionContext` fields plus `principalType`, `tenant`, `measurement`, `sqlAudit`, `permissions`. Event constructors take `scope: Scope` and pass it as `scope as never` to `BaseDomainEvent` (the cast is intentional and correct; see HANDOFF gotchas).

### Unit of Work + sealed Result

Guarantees that aggregate persistence, domain event creation, and local audit-log writes are atomic. The SDK's sealed `Result<T>` is the type-level UoW gate: `Result.success(token, value)` requires an internal token that only `UnitOfWork` implementations hold, so a use case can't fabricate a synthetic success — it must route through `unitOfWork.commit(...)` (or the registry-aware `commitAggregate` helper). Bypassing UoW = the use case can't return a `Result<TEvent>` at all.

The full per-request flow:

1. Route handler reads `Scope` from `ScopeStore`, builds the command, calls `appContext.runWrite(() => useCase.execute(command))`.
2. `runWrite` opens a Drizzle tx through `TransactionManager`, binds it on `TransactionStore` (ALS), then invokes the thunk.
3. Use case validates input, performs authorization, reads repos via `await this.repo.x()`, builds the aggregate + event, then `return commitAggregate(this.uow, this.registry, agg, event, cmd)`.
4. `commitAggregate` → `uow.commitAggregate(agg, event, cmd, persistCallback)` from the SDK's `OutboxUnitOfWork`. The persist callback runs inside the SDK's commit: `registry.persist(agg, tx)` + `writeLocalAuditLog(tx, event, cmd)`. Then the SDK writes the outbox event + outbox audit row via the same tx-bound `DrizzleOutboxDriver`. All four writes commit atomically.
5. Result surfaces as `Result<TEvent>`. Route handler does `if (isFailure(result)) return sendUseCaseError(reply, result.error);`, then `result.value.getData()` for the typed event payload.

The `fc-outbox-processor` reads from `outbox_messages` and dispatches to the FlowCatalyst platform — not pinpoint's concern.

**Supporting infrastructure** (all in `@flowcatalyst-apps/app-framework`, re-exported via `@pinpoint/framework`):

- **`TransactionManager`** — wraps Drizzle's `db.transaction()`
- **`TransactionStore`** — ALS holding the active Drizzle tx; bound by `runWrite`
- **`AggregateRegistry`** (impl) — dispatches `persist` / `delete` to the correct repository by ID prefix
- **`DrizzleOutboxDriver`** — ALS-aware, stateless, shared across requests
- **`buildOutboxManager({ clientId })`** — builds the single `OutboxManager`
- **`createUnitOfWork(manager)`** — non-Effect SDK `OutboxUnitOfWork` instance over the shared manager
- **`commitAggregate(uow, registry, agg, event, cmd)` / `commitDelete(...)` / `emitEvent(...)`** — plain helpers that wrap `uow.commitAggregate(...)` with the registry + local-audit persist callback

There is no `DispatchJobBroker` in pinpoint (fulfil-only, for cross-aggregate fan-out). Pinpoint's use cases are scoped to single aggregates with the optional cascade in `confirm-master-location` doing repeated `commitAggregate` calls inside the same tx.

### Use case pattern

Every write operation is a use case. Each use case lives in its own directory under `operations/`. Use cases return `Promise<Result<TEvent>>`; the sealed `Result<T>` makes UoW-bypass impossible. The reference implementation is `server/src/operations/create-client/create-client.use-case.ts` — copy its shape.

#### File layout

```
operations/
└── create-client/
    ├── create-client.command.ts       # Re-export from @pinpoint/shared (Zod type)
    └── create-client.use-case.ts      # The async handler

domain/tenancy/
├── ids.ts                             # Branded ID types + prefixes + as-casters
├── client.ts                          # Aggregate interface + namespace (create, rename, …)
├── client.repository.ts               # Repository interface (Promise-typed, NOT Effect Tag)
└── events/
    └── client-created.event.ts        # extends BaseDomainEvent<TData>, ctx: Scope
```

Commands are Zod-validated in `@pinpoint/shared`. The operations folder re-exports the type.

#### Use case shape

```typescript
import { generateTsid } from '@flowcatalyst/sdk';
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { Client } from '../../domain/tenancy/client.js';
import { asClientId, CLIENT_ID_PREFIX } from '../../domain/tenancy/ids.js';
import { ClientCreated } from '../../domain/tenancy/events/client-created.event.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { CreateClientCommand } from './create-client.command.js';

export class CreateClientUseCase {
  // Permission constant — referenced by authorize() and surfaced for documentation / role wiring.
  static readonly requiredPermission = PinpointPermission.TenancyClientCreate;

  // ALL deps via constructor: uow, registry, repos, optional services.
  // app-context.ts constructs each use case with its required deps.
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly clients: ClientRepository,
  ) {}

  async execute(command: CreateClientCommand): Promise<Result<ClientCreated>> {
    // 1. Identity (from ScopeStore ALS)
    const scope = ScopeStore.require();

    // 2. Authorization
    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${PinpointPermission.TenancyClientCreate}.`,
        ),
      );
    }

    // 3. Input validation
    const name = command.name.trim();
    const code = command.code.trim();
    if (name.length === 0) {
      return Result.failure(
        UseCaseError.validation('CLIENT_NAME_REQUIRED', 'Client name must not be empty.'),
      );
    }
    if (code.length === 0) {
      return Result.failure(
        UseCaseError.validation('CLIENT_CODE_REQUIRED', 'Client code must not be empty.'),
      );
    }

    // 4. Repository reads — plain await. Repos throw on infra failures;
    //    the tx rolls back. Don't try/catch unless you have a specific
    //    business-rule to surface.
    const existing = await this.clients.findByCode(code);
    if (existing) {
      return Result.failure(
        UseCaseError.businessRule(
          'CLIENT_CODE_EXISTS',
          `A client with code '${code}' already exists.`,
          { existingClientId: existing.id },
        ),
      );
    }

    // 5. Build aggregate + event
    const id = asClientId(`${CLIENT_ID_PREFIX}_${generateTsid()}`);
    const client = Client.create({ id, name, code, now: new Date() });
    const event = new ClientCreated(scope, { clientId: id, name, code });

    // 6. Atomic commit — the ONLY path that produces Result.success(ClientCreated).
    return commitAggregate(this.uow, this.registry, client, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CreateClientUseCase.requiredPermission);
  }
}
```

#### Recipe — adding a new operation end-to-end

For an operation called `assign-territory`:

1. **Command** — define the Zod schema + type in `apps/pinpoint/shared/src/contracts/<subdomain>/assign-territory.contract.ts`, re-export from `@pinpoint/shared`. Then `apps/pinpoint/server/src/operations/assign-territory/assign-territory.command.ts` re-exports the type.
2. **Event** — `server/src/domain/<subdomain>/events/territory-assigned.event.ts`, extends `BaseDomainEvent<TerritoryAssignedData>`, constructor takes `scope: Scope` and calls `super({...}, scope as never, data)`.
3. **TypeBox event schema** (for OpenAPI + platform sync) — `server/src/domain/<subdomain>/events/territory-assigned.event.ts` exports `TerritoryAssignedDataSchema` + a `TerritoryAssignedEventType` const for `scripts/sync-flowcatalyst.ts` to push.
4. **Use case** — `server/src/operations/assign-territory/assign-territory.use-case.ts`. Constructor takes `(uow, registry, ...repos)`. Implement `async execute(...)` as shown above.
5. **Route** — `server/src/api/routes/<subdomain>/assign-territory.route.ts`. Accept `appContext: AppContext`. Build the command from the body, call `appContext.runWrite(() => uc.execute(command))`, branch on `isFailure(result)`, return `result.value.getData()` on success.
6. **Wire it** — in `server/src/app-context.ts`:
   - If new aggregate: add the prefix to `createAggregateRegistry({...})`, add a `registerXxx` call.
   - Add the repository: `const territoryRepo = createDrizzleTerritoryRepository(db);`
   - Construct the use case: `assignTerritory: new AssignTerritoryUseCase(uow, aggregateRegistry, territoryRepo)`
7. **Plugin** — register the route inside the relevant `api/routes/<subdomain>/index.ts` plugin.

#### Conventions every use case follows

- **`async execute(cmd): Promise<Result<TEvent>>`** — a plain async method, NOT an Effect generator. No `function*`, no `yield*`, no Effect imports.
- **All deps via constructor.** `(uow, registry, ...repos, ...services)` — explicit. `app-context.ts` is the only place that constructs use cases. No DI container.
- **Identity from `ScopeStore.require()`**, NOT a parameter. Same as fulfil.
- **All failures via `Result.failure(UseCaseError.x(code, message, details?))`.** Use the right factory: `validation` (input wrong), `authorization` (principal lacks permission), `notFound` (target missing), `businessRule` (invariant broken), `concurrency` (version conflict), `infrastructure` (DB / network — usually thrown, not returned). Never `throw` for business-logic flow; throw is reserved for infra failures that should roll back the tx.
- **DB reads via plain `await this.repo.method(args)`.** No try/catch unless there's a specific business-rule reading on the result. Infra failures throw and the surrounding `runWrite` rolls back the tx.
- **`commitAggregate(this.uow, this.registry, agg, event, cmd)` for state changes.** `commitDelete(this.uow, this.registry, agg, event, cmd)` for removals. `emitEvent(this.uow, event, cmd)` for events with no aggregate change. All three return `Promise<Result<E>>` and are the only paths to success.
- **Events take `scope: Scope`** and `super(..., scope as never, data)` — the cast satisfies the SDK's `ExecutionContext` interface (Scope is structurally a superset). Don't try to "fix" it.
- **`generateTsid()`** for new IDs (from `@flowcatalyst/sdk`). Prefix with the subdomain's prefix from `ids.ts`.
- **Cascade: short-circuit on inner commit failure.** When `confirm-master-location` or `create-location` calls `commitAggregate` multiple times in the same tx, the pattern is `const r = await commitAggregate(...); if (isFailure(r)) return r;`. Works because `Failure<T>` has a phantom type parameter — a `Failure<Child>` is structurally assignable to `Result<Parent>`.

#### Sealed `Result<T>` — the type-level UoW gate

`Result<T>` is a discriminated union with `_tag: 'success' | 'failure'`. The success variant has `value: T`; the failure variant has `error: UseCaseError`. Construction is restricted:

- `Result.failure(error)` — any code can call this. Public.
- `Result.success(TOKEN, value)` — requires an internal token (`RESULT_SUCCESS_TOKEN`) that the SDK exports only inside its UoW module. **You cannot fabricate a success from use-case code.** You must route through `uow.commit(...)` (or `commitAggregate(...)`), which holds the token.

This means a use case that goes `return Result.success(value)` doesn't compile. The compiler forces every success path to flow through UoW commit, which forces the outbox event to land. Same guarantee fulfil's `Sealed<E>` brand gives, runtime-checked via the token instead of type-branded.

**One escape hatch in tests:** fakes that don't care about the value structure can fabricate `{ _tag: 'success', value: { getData: () => ({}) } } as never`. The scheduling worker test does this. Don't do it in production code.

#### Testing a use case

Integration tests are the primary harness. They use a single `@testcontainers/postgresql` instance shared across the run, build a real `AppContext` over it via `getTestAppContext()`, and exercise the use case through the real `runWrite` boundary.

```typescript
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isSuccess, isFailure } from '@pinpoint/framework';
import { sql } from 'drizzle-orm';
import { cleanDb, getDbFixture } from '../db-fixture.js';
import { getTestAppContext, runInScope } from '../test-app-context.js';
import type { AppContext } from '../../../src/app-context.js';

describe('CreateClientUseCase (integration)', () => {
  let appContext: AppContext;
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];

  beforeAll(async () => {
    const fixture = await getDbFixture();
    db = fixture.db;
    appContext = await getTestAppContext();
  });

  beforeEach(async () => {
    await cleanDb();
  });

  it('persists a client and emits a ClientCreated audit-log row in the same tx', async () => {
    const result = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
      ),
    );

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;

    const clientId = result.value.getData().clientId;
    expect(clientId).toMatch(/^cli_/);

    const events = await db.execute(sql`
      SELECT 1 FROM outbox_messages
      WHERE type = 'EVENT' AND payload::jsonb->>'type' = 'pinpoint:tenancy:client:created'
    `);
    expect(events.length).toBe(1);
  });

  it('rejects a duplicate code with a business-rule failure', async () => {
    // ... seed first ...
    const second = await runInScope({ sub: 'prn_test_principal' }, () =>
      appContext.runWrite(() =>
        appContext.useCases.createClient.execute({ name: 'Other', code: 'DUP' }),
      ),
    );

    expect(isFailure(second)).toBe(true);
    if (!isFailure(second)) return;
    expect(second.error.type).toBe('business_rule');
    expect(second.error.code).toBe('CLIENT_CODE_EXISTS');
  });
});
```

`runInScope(token, fn)` binds a `ScopeStore` for the duration. `appContext.runWrite` opens a Drizzle tx. Both `outbox_messages` and the aggregate row land in the same tx; `cleanDb()` truncates everything between tests.

**No `TestUnitOfWork` equivalent.** Pinpoint's tests run against the real DB. Unit tests (in `src/**/*.test.ts`) use plain fakes for pure logic — repos, services, fetch — and don't touch the UoW boundary.

#### Route handler shape

Routes are thin: build the command, call `runWrite`, branch on the `Result`. The handler does NOT open transactions or provide infrastructure — `runWrite` does all of that.

```typescript
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { CreateClientCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';

export function registerCreateClientRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post('/clients', { schema: /* ... */ }, async (request, reply) => {
    const parsed = CreateClientCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
    }

    const scope = ScopeStore.get();
    if (!scope) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
    }

    const result = await appContext.runWrite(() =>
      appContext.useCases.createClient.execute(parsed.data),
    );

    if (isFailure(result)) {
      return sendUseCaseError(reply, result.error);
    }

    const event = result.value;
    const data = event.getData();
    return reply.code(201).send({
      clientId: data.clientId,
      createdAt: event.time.toISOString(),
    });
  });
}
```

`sendUseCaseError(reply, error)` reads `error.type` and maps to the HTTP status via `UseCaseError.httpStatus(error)`.

**Route response schemas must declare every status code the handler emits.** Fastify + TypeBox typechecks reply codes against the schema's `response` keys. The standard `ErrorResponseSchema` is in `tenancy/clients/create-client.route.ts` — reuse it.

## Pattern divergences from fulfil

When reading `apps/fulfil/CLAUDE.md` or borrowing patterns from fulfil's code, translate as follows:

| Fulfil (Effect)                                                                                 | Pinpoint (plain)                                                            |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Effect.Effect<Sealed<E>, UseCaseError, UnitOfWork \| AggregateRegistry>`                       | `Promise<Result<TEvent>>`                                                   |
| `Effect.gen(function* () { ... })`                                                              | `async () => { ... }`                                                       |
| `yield* X` (where `X` is a `Context.Service` Tag)                                               | `await this.repo.x(...)` (plain repo injected via constructor)              |
| `yield* Effect.tryPromise({ try, catch })`                                                      | `await this.service.x()` — let infra errors throw; tx rolls back            |
| `Effect.fail(new ValidationError({ code, message }))`                                           | `Result.failure(UseCaseError.validation(code, message, details?))`          |
| `result.success.event` / `result.success.event.getData()`                                       | `result.value` / `result.value.getData()`                                   |
| `result.failure._tag === 'BusinessRuleViolation'`                                               | `result.error.type === 'business_rule'`                                     |
| `Result.isSuccess(result)` (from `'effect'`)                                                    | `isSuccess(result)` (from `@pinpoint/framework`)                            |
| Use case constructor: `constructor(private readonly orders: OrderRepository)` (repo only)       | `constructor(uow, registry, ...repos, ...services)` (everything)            |
| `appContext.runWrite(useCase.execute(command), scope)` (Effect program + explicit scope)        | `appContext.runWrite(() => useCase.execute(command))` (thunk; scope is ALS) |
| Repo: Promise-typed interface + `Context.Service` Tag + `.layer(port)` adapter (3 files in one) | Repo: Promise-typed interface + Drizzle impl (only 2 surfaces)              |
| `TestUnitOfWork.layer(buffer)` for unit-testing use cases                                       | No equivalent — integration tests use real `runWrite` + testcontainers      |
| `DispatchJobBroker` for cross-aggregate fan-out                                                 | Not used (pinpoint has no fan-out today; if needed, expose plainly via SDK) |

UoW + outbox + audit semantics are **identical** — same `OutboxManager`, same `DrizzleOutboxDriver`, same `TransactionStore` ALS, same `audit_logs` table. Only the call shape differs.

## External services

Pinpoint integrates with three external HTTP services. Each one is a plain async interface in `domain/services/` with a Drizzle-style impl in `infrastructure/services/`:

- **Photon geocoder** — `GeocoderService` (`infrastructure/services/photon-geocoder.ts`). Configurable via `PINPOINT_GEOCODING_API_URL` (defaults to `https://photon.komoot.io`). Wrapped by `createRateLimitedGeocoder` — plain in-process token-bucket, burst capacity = `PINPOINT_GEOCODING_RATE_LIMIT` (rps), defaults to 5.
- **libpostal sidecar** — `AddressNormalizer` (`infrastructure/services/libpostal-normalizer.ts`). HTTP client for `pelias/libpostal-service`. Configurable via `PINPOINT_LIBPOSTAL_URL` (defaults to `http://localhost:4400`). The Docker compose stack runs it as a sidecar.
- **LLM address verifier** — `AddressVerifier`. Three impls: `BedrockVerifier` (Vercel AI SDK + `@ai-sdk/amazon-bedrock`), `OllamaVerifier` (native `/api/chat` to avoid the `ollama-ai-provider-v2` zod-4 peer), `NoopVerifier` (default). Selected via `PINPOINT_LLM_PROVIDER=none|bedrock|ollama`. Returns `null` on any failure — the matching pipeline treats `null` as "no verification opinion" and falls back to the algorithmic verdict.

All three are constructor-injected into the use cases that need them. No service is wrapped in Effect or in a SDK Tag.

## Scheduling

Platform-driven, not in-process. `scheduling/validate-master-locations.ts` exports `runValidateMasterLocationsBatch(appContext, config?)` — a plain async batch handler that drains GEOCODED master_locations and calls `confirm-master-location` on each. The FlowCatalyst platform fires `pinpoint-validate-master-locations` every 5 min via HMAC-signed POST to `/jobs/validate-master-locations` (definition in `flowcatalyst/scheduled-jobs.ts`, synced via `pnpm flowcatalyst:sync`).

Per-master error containment: each `confirm-master-location` runs in its own `runWrite` tx; a `Result.failure` or thrown infra error is recorded in `failures` without aborting the batch. The handler returns the aggregate summary; the SDK doesn't require a sealed-event response for webhook handlers.

HMAC verification via `flowcatalystWebhookAuthHook` from `@flowcatalyst-apps/app-framework`. Env: `FLOWCATALYST_SIGNING_SECRET` (required for prod; unset = dev-mode bypass with per-request warning).

## Auth

- **OIDC** via `openid-client` v6. PKCE-with-S256 authorization-code flow with refresh tokens. Configured via `OIDC_*` env vars (issuer URL, audience, client id/secret, redirect URI, scopes).
- **Session cookie** (`pp_session`, `HttpOnly`+`SameSite=Lax`). Driver-pluggable via `PINPOINT_SESSION_DRIVER=memory|redis|postgres`. The Redis driver lazy-imports `ioredis` so memory/postgres deploys skip the dep.
- **In-band session refresh** — when an access token fails validation, the session-cookie path attempts one refresh-token exchange before returning 401.
- **Dev fallback** — `x-user-id: <principalId>` header path, gated on `PINPOINT_AUTH_DEV_FALLBACK=true`. Grants ALL permissions. NEVER enable in prod.
- **Permission catalog** — `PinpointPermission` enum in `@pinpoint/shared`. Each use case declares `static readonly requiredPermission = ...` and checks `scope.permissions.has(...)` in its `authorize(scope)` method.

## Routes

Two HTTP surfaces:

- **Canonical API** under `/clients/:clientId/...` — mirrors the Rust pinpoint API shape. Plus unscoped routes: `/me`, `/countries`, `/health`, `/geocode/*`, `/verify-match`, `/jobs/*`.
- **BFF surface** under `/bff/clients/:cid/...` — backs the Vue SPA. ~40 routes across 11 mount points. Plus the cross-client `GET /master-locations/unvalidated`.

Both surfaces use the same use cases; routes are thin shells. See `docs/route-triage.md` for the full route map vs the Rust source.

## Drizzle migrations

Three migrations applied: schema, countries + global-default-matching-config seed, 10c BFF additions. Generate new ones with `pnpm db:generate`; seed migrations use `drizzle-kit generate --custom --name <slug>` (the journal won't pick up hand-dropped `.sql` files otherwise).

**PostGIS geometry requires `codec: 'text'` on the Drizzle `customType`.** Drizzle 1.0 RC's built-in `geometry` codec routes any `geometry(*)` column through `parseEWKB`, which only handles POINT. The customType in `infrastructure/schema/types/geometry.ts` opts out. See `docs/spatial-queries.md`.

## Composition root

`server/src/app-context.ts` is the only file that:

- builds repos (`createDrizzleXxxRepository(db)`)
- builds the aggregate registry + prefix map
- registers aggregate handlers (`registerClient(registry, clientRepo)` etc.)
- builds the `OutboxManager` and the non-Effect `UnitOfWork`
- constructs every use case with its deps
- defines `runWrite(thunk)` — opens a Drizzle tx, binds it on ALS, invokes the thunk

Keep it dumb — wiring only, no business logic. New use cases: add the import, add the constructor call to the `useCases` block. New repos: add the repo construction + handler registration.

## What to read after this file

In order:

1. `apps/pinpoint/docs/HANDOFF.md` — pickup state, slice notes, every gotcha discovered during the port (and there are many). Read this before making non-trivial changes.
2. `apps/pinpoint/docs/MIGRATION_PLAN.md` — historical slice ordering + scope adjustments. Useful when reading old commit messages.
3. `apps/pinpoint/docs/spatial-queries.md` — PostGIS + Drizzle 1.0 RC gotchas. Read this before touching any geometry column.
4. `apps/pinpoint/docs/integration-testing.md` — testcontainers harness shape. Read this before adding integration tests.
5. `apps/fulfil/CLAUDE.md` — the Effect-stack reference. Useful for architectural background; **translate the use-case + repo shapes** via the table above before applying anything to pinpoint code.
