/**
 * Postgres testcontainer fixture for integration tests.
 *
 * Brings up one PostGIS-enabled Postgres container per test run (started
 * by `globalSetup` below), runs Pinpoint's full migration stack into
 * it, and exposes a `db` instance + a `cleanDb()` helper that truncates
 * every app table between tests.
 *
 * Container choice: imresamu/postgis:18-3.6 — the same image used by
 * dev compose, so any quirk we hit in tests reproduces locally too.
 *
 * Per-test cleanup uses `TRUNCATE … RESTART IDENTITY CASCADE` rather
 * than DROP + recreate; truncation is order-of-magnitude faster and the
 * countries/global-default seed survives across tests so the matching
 * pipeline doesn't have to reseed each time.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';

const SCHEMA = 'pinpoint';
const DRIZZLE_DIR = resolve(import.meta.dirname, '../../drizzle');

interface DbFixtureState {
  readonly container: StartedTestContainer;
  readonly url: string;
  readonly sql: Sql;
  readonly db: ReturnType<typeof drizzle>;
  readonly truncatables: readonly string[];
}

let state: DbFixtureState | null = null;
let startPromise: Promise<DbFixtureState> | null = null;

async function bootstrap(): Promise<DbFixtureState> {
  const container = await new GenericContainer('imresamu/postgis:18-3.6')
    .withEnvironment({
      POSTGRES_USER: 'pinpoint',
      POSTGRES_PASSWORD: 'pinpoint',
      POSTGRES_DB: 'pinpoint',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(60_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const url = `postgres://pinpoint:pinpoint@${host}:${port}/pinpoint`;

  // Mirror `scripts/db-init.ts`: schema, extensions, role search_path.
  const adminSql = postgres(url, { onnotice: () => {} });
  await adminSql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  await adminSql.unsafe(`CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public`);
  await adminSql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public`);
  await adminSql.unsafe(
    `ALTER ROLE "pinpoint" IN DATABASE "pinpoint" SET search_path TO "${SCHEMA}", public`,
  );
  await adminSql.end({ timeout: 1 });

  // App-side connection — reopens so the search_path ALTER takes effect.
  const sql = postgres(url);
  const db = drizzle({ client: sql });

  // Apply the SDK's outbox_messages migration before pinpoint's own
  // migrations — anything that calls commitAggregate writes to it via
  // DrizzleOutboxDriver. The SDK ships the .sql alongside its dist; we
  // resolve the main entry and walk up so pnpm's content-hashed install
  // path isn't hard-coded. (The SDK's package.json doesn't expose
  // `./package.json` in its exports map, so we can't resolve that
  // directly.)
  // ESM resolution honours the SDK's `exports` map; CJS `require.resolve`
  // doesn't, which is why we use `import.meta.resolve` here.
  const sdkEntryUrl = import.meta.resolve('@flowcatalyst/sdk');
  const sdkEntry = fileURLToPath(sdkEntryUrl);
  // SDK ships as <root>/dist/index.js — two dirs up gets us <root>.
  const sdkRoot = dirname(dirname(sdkEntry));
  const outboxMigration = await readFile(
    resolve(sdkRoot, 'migrations/postgresql/001_create_outbox_messages.sql'),
    'utf8',
  );
  // Force the outbox_messages table + its indexes into the `pinpoint`
  // schema so cleanDb's TRUNCATE picks it up. Without this, the SDK
  // migration runs unqualified and lands in whatever search_path[0] is
  // at session-start, which depends on whether the role's ALTER had
  // propagated yet — flaky.
  const qualifiedMigration = outboxMigration
    .replace(/\bCREATE TABLE outbox_messages\b/g, `CREATE TABLE "${SCHEMA}"."outbox_messages"`)
    .replace(/\bON outbox_messages\b/g, `ON "${SCHEMA}"."outbox_messages"`);
  await sql.unsafe(qualifiedMigration);

  await migrate(db, { migrationsFolder: DRIZZLE_DIR, migrationsSchema: SCHEMA });

  // Discover every app table from information_schema. Doing it once at
  // bootstrap means tests that add new tables get covered automatically.
  const tableRows = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = ${SCHEMA}
      AND tablename != '__drizzle_migrations'
  `;
  const truncatables = tableRows.map((r) => r.tablename);

  return { container, url, sql, db, truncatables };
}

/**
 * Lazy initialiser. Tests call `getDbFixture()` rather than expecting a
 * vitest `globalSetup` because globalSetup runs in a separate worker
 * (no module sharing). A lazy promise also lets us skip the container
 * boot when no integration tests run in a particular CLI invocation
 * (`vitest run path/to/unit.test.ts` doesn't import this module).
 */
export async function getDbFixture(): Promise<{
  url: string;
  db: ReturnType<typeof drizzle>;
  sql: Sql;
}> {
  if (state) return { url: state.url, db: state.db, sql: state.sql };
  if (!startPromise) startPromise = bootstrap();
  state = await startPromise;
  return { url: state.url, db: state.db, sql: state.sql };
}

/**
 * Wipe all app tables. Run from `beforeEach` in every integration test.
 * Uses one TRUNCATE with the full table list — Postgres handles cascade
 * + identity reset in a single statement, which is cheaper than per-
 * table truncation and avoids FK-ordering headaches.
 */
export async function cleanDb(): Promise<void> {
  const fixture = state ?? (await bootstrap());
  if (state === null) state = fixture as DbFixtureState;
  if (state.truncatables.length === 0) return;
  const list = state.truncatables.map((t) => `"${SCHEMA}"."${t}"`).join(', ');
  await state.sql.unsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * Tear down the container + close the pool. Called by vitest's
 * `globalTeardown` so a single container is reused across the whole
 * test run.
 */
export async function teardownDbFixture(): Promise<void> {
  if (!state) return;
  await state.sql.end({ timeout: 1 });
  await state.container.stop();
  state = null;
  startPromise = null;
}
