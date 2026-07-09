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
 * helper. The `OutboxManager` / `DrizzleOutboxDriver` write to this table on
 * every `commitAggregate`, so it must exist before any write runs.
 * Idempotent: skips when the table already exists.
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
 * Startup database migration, safe to run from every replica concurrently —
 * a Postgres advisory lock serializes so exactly one replica migrates and the
 * rest wait, then see an up-to-date journal and no-op.
 *
 * Gated by FULFILGO_DB_AUTO_MIGRATE=true (see server.ts). Local/dev/test keep
 * using `pnpm db:init` + `pnpm db:migrate` and leave this off.
 */

// fulfil-go-specific advisory-lock key. Any constant works as long as no
// other app on a shared instance reuses it (pinpoint uses 472_700_101).
const MIGRATION_LOCK_KEY = 472_700_202;

interface MigrationLogger {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export async function runStartupMigrations(log: MigrationLogger): Promise<void> {
  // Dedicated single connection — DDL + migrator run serially here, separate
  // from the app pool.
  const sql = makeSql({ max: 1 });
  try {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${DB_SCHEMA}"`);

    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY}::bigint)`;
    try {
      // The SDK-owned outbox table is created first — it's not part of the
      // Drizzle journal (the SDK ships it as a standalone .sql) and every
      // commitAggregate writes to it.
      const createdOutbox = await applyOutboxTableMigration(sql, DB_SCHEMA);
      if (createdOutbox) {
        log.info({ schema: DB_SCHEMA }, '[db] SDK outbox_messages table created');
      }

      // dist/infrastructure/migrate.js -> ../../drizzle = <pkg-root>/drizzle
      // (and src/infrastructure -> ../../drizzle locally under tsx).
      const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
      await migrate(drizzle({ client: sql }), { migrationsFolder });
      log.info({ migrationsFolder, schema: DB_SCHEMA }, '[db] fulfil-go migrations applied');
    } finally {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
