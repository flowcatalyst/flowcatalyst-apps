import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { DB_SCHEMA, makeSql } from './db.js';

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
