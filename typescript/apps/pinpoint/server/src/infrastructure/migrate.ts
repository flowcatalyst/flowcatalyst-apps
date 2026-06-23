import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { DB_SCHEMA, makeSql } from './db.js';

type Sql = ReturnType<typeof makeSql>;

/**
 * Create the SDK's `outbox_messages` table (+ indexes) in `schema` if it's
 * absent. The SDK ships this as a plain `.sql` file — there is no runtime DDL
 * helper (only the cache store has one). The `OutboxManager` /
 * `DrizzleOutboxDriver` write to this table on every `commitAggregate`, so it
 * must exist before any write runs. Idempotent: skips when the table already
 * exists. Returns true when it created the table.
 */
export async function applyOutboxTableMigration(sql: Sql, schema: string): Promise<boolean> {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT to_regclass(${`"${schema}".outbox_messages`}) IS NOT NULL AS exists
  `;
  if (row?.exists) return false;

  // The SDK ships the DDL at <sdk-root>/migrations/postgresql/. Resolve the
  // package entry (import.meta.resolve honours the exports map) and walk up
  // from dist/index.js to the package root.
  const sdkEntry = fileURLToPath(import.meta.resolve('@flowcatalyst/sdk'));
  const sdkRoot = dirname(dirname(sdkEntry));
  const raw = await readFile(
    resolve(sdkRoot, 'migrations/postgresql/001_create_outbox_messages.sql'),
    'utf8',
  );
  // The .sql is unqualified; pin the table + its indexes into `schema` so they
  // don't land in whatever the session search_path happens to be.
  const qualified = raw
    .replace(/\bCREATE TABLE outbox_messages\b/g, `CREATE TABLE "${schema}"."outbox_messages"`)
    .replace(/\bON outbox_messages\b/g, `ON "${schema}"."outbox_messages"`);
  await sql.unsafe(qualified);
  return true;
}

/**
 * Startup database migration, safe to run from every replica concurrently.
 *
 * In prod, pinpoint shares the platform's RDS instance and runs as the master
 * role. On boot it ensures its schema + extensions exist, then applies any
 * pending Drizzle migrations — all under a Postgres session-level advisory
 * lock so that with N replicas exactly one migrates and the rest wait, then
 * see an up-to-date journal and no-op.
 *
 * Gated by PINPOINT_DB_AUTO_MIGRATE=true (see server.ts). Local/dev/test keep
 * using `pnpm db:init` + `pnpm db:migrate` and leave this off.
 */

// Pinpoint-specific advisory-lock key. Any constant works as long as no other
// app on this shared instance reuses it. Cast to bigint to bind the
// single-arg pg_advisory_lock(bigint) overload unambiguously.
const MIGRATION_LOCK_KEY = 472_700_101;

interface MigrationLogger {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export async function runStartupMigrations(log: MigrationLogger): Promise<void> {
  // Dedicated single connection — DDL + migrator run serially here, separate
  // from the app pool.
  const sql = makeSql({ max: 1 });
  try {
    // Schema + extensions must exist before any migration runs. postgis /
    // pg_trgm live in `public` so their functions stay unqualified across the
    // schemas that share this database. CREATE EXTENSION needs an elevated
    // role — the RDS master role qualifies.
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${DB_SCHEMA}"`);
    await sql.unsafe('CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public');
    await sql.unsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public');

    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY}::bigint)`;
    try {
      // The SDK-owned outbox table is created first — it's not part of the
      // Drizzle journal (the SDK ships it as a standalone .sql) and every
      // commitAggregate writes to it.
      const createdOutbox = await applyOutboxTableMigration(sql, DB_SCHEMA);
      if (createdOutbox) {
        log.info({ schema: DB_SCHEMA }, '[db] SDK outbox_messages table created');
      }

      // dist/infrastructure/migrate.js -> ../../drizzle = <pkg-root>/drizzle,
      // where `pnpm deploy` places the migration files in the runtime image
      // (and src/infrastructure -> ../../drizzle locally under tsx).
      const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
      await migrate(drizzle({ client: sql }), { migrationsFolder });
      log.info({ migrationsFolder, schema: DB_SCHEMA }, '[db] pinpoint migrations applied');
    } finally {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
