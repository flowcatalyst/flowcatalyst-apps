# Integration testing

Slice 12.3 added an integration-test harness backed by
`@testcontainers/postgresql`. Tests bring up a real PostGIS Postgres
container, run all pinpoint migrations + the SDK's `outbox_messages`
migration into it, and exercise the Drizzle repos / use-cases against
that DB.

Existing unit tests stay untouched in `src/**/*.test.ts` and continue
to run via `pnpm test`. Integration tests live separately under
`test/integration/` and run via `pnpm test:integration`.

## Layout

```
apps/pinpoint/server/
  vitest.config.ts                — unit config, excludes test/integration
  vitest.integration.config.ts    — integration config, includes only test/integration
  test/integration/
    db-fixture.ts                 — container lifecycle + migration runner
    global-setup.ts               — vitest globalSetup hook (teardown only)
    test-app-context.ts           — builds a real AppContext on the testcontainer db
    repositories/
      client-repository.test.ts
      partition-repository.test.ts
      principal-repository.test.ts
      layer-repository.test.ts
    use-cases/
      create-client.use-case.test.ts
      replace-property-set-properties.use-case.test.ts
```

## Running

```sh
pnpm -F @pinpoint/server test                    # unit (~83 tests, ~1s)
pnpm -F @pinpoint/server test:integration        # integration (~25 tests, ~30s)
pnpm -F @pinpoint/server test:all                # both
```

The integration suite requires Docker. The container image
(`imresamu/postgis:18-3.6`) matches the dev compose so the image is
already cached after `pnpm db:up`.

## How the harness works

- `db-fixture.ts` boots one container per test run on first call to
  `getDbFixture()`. Bootstrap mirrors `scripts/db-init.ts` (schema +
  postgis + pg_trgm + role search_path), then applies the SDK's
  `001_create_outbox_messages.sql` migration (rewritten on the fly to
  fully-qualify the table into the `pinpoint` schema so cleanDb can
  truncate it), then runs every drizzle migration via
  `drizzle-orm/postgres-js/migrator`.
- `cleanDb()` runs in every test's `beforeEach`, single
  `TRUNCATE … RESTART IDENTITY CASCADE` of every table in the pinpoint
  schema.
- `teardownDbFixture()` is invoked by vitest globalSetup at the end of
  the run, stopping the container + closing the pool.
- `vitest.integration.config.ts` pins `fileParallelism: false` — the
  shared container can only handle one suite at a time. Per-suite
  parallelism is fine because tests truncate between themselves.

## Writing a repo test

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDrizzleClientRepository } from '../../../src/infrastructure/client-repository.js';
import { cleanDb, getDbFixture } from '../db-fixture.js';

describe('ClientRepository (integration)', () => {
  let repo: ReturnType<typeof createDrizzleClientRepository>;

  beforeAll(async () => {
    const { db } = await getDbFixture();
    repo = createDrizzleClientRepository(db);
  });

  beforeEach(async () => {
    await cleanDb();
  });

  it('persists + finds by id', async () => {
    /* … */
  });
});
```

## Writing a use-case test

Use-case tests need the real `AppContext` (for `runWrite`, the
`AggregateRegistry`, the `OutboxManager`, …) plus a `ScopeStore`
binding around every `runWrite` call so `commitAggregate`'s
`ScopeStore.require()` finds a principal:

```ts
import { getTestAppContext, runInScope } from '../test-app-context.js';

const ctx = await getTestAppContext();

const result = await runInScope({ sub: 'prn_test' }, () =>
  ctx.runWrite(
    ctx.useCases.createClient.execute({ name: 'Acme', code: 'ACME' }),
    undefined as any, // scope param is legacy; the real scope comes from ScopeStore.
  ),
);
```

Verify side effects against both `outbox_messages` and `audit_logs`:

```ts
import { sql } from 'drizzle-orm';

const events = await db.execute(sql`
  SELECT payload FROM outbox_messages
  WHERE type = 'EVENT'
    AND payload::jsonb->>'type' = 'pinpoint:tenancy:client:created'
`);
expect(events.length).toBe(1);

const audits = await db.execute(sql`
  SELECT entity_id FROM audit_logs WHERE entity_type = 'Client'
`);
expect(audits.length).toBe(1);
```

The `outbox_messages.type` column is the message-kind discriminator
(`EVENT` / `AUDIT_LOG` / `DISPATCH_JOB`); the CloudEvents event-type
code lives inside `payload`. Filter on both.

## What's covered

- **Repos**: Client, Partition, Principal (incl. partition-grant /
  revoke), Layer (incl. PostGIS round-trip).
- **Use cases**: create-client (happy path + duplicate-code rejection),
  replace-property-set-properties (happy path + cap-6 + duplicate-key).

## What's NOT covered (deferred follow-up)

- **Repos**: Country, Location, LayerFeature, MatchingConfig,
  MasterLocation, ProcessingLog, LocationAttribute, PropertySet —
  follow the patterns above. MasterLocation in particular exercises
  pg_trgm fuzzy-match queries that are worth their own tests.
- **Use cases**: all of update/delete-client, update/delete-partition,
  create/update/delete-layer, create/update/delete-layer-feature,
  create/update/delete-property-set, update-matching-config,
  validate-master-location, confirm-master-location, update- /
  reject-master-location, create-location (the big one, with the full
  matching pipeline). About 18 use cases still to backfill.
- **End-to-end OIDC**: a Keycloak / Auth0 testcontainer exercising the
  `/auth/login` → `/auth/callback` → cookie-session → API flow. Not
  blocking unit-level confidence; worth adding before cutover.

Adding a new test follows the patterns above — no new harness
machinery needed. The bottleneck is just writer time.
