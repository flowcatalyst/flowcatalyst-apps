/**
 * Idempotent local-dev DB bootstrap for pinpoint.
 *
 * Run after `pnpm db:up` to make sure the running Postgres container has:
 *   1. the `pinpoint` schema (CREATE SCHEMA IF NOT EXISTS)
 *   2. the postgis extension installed (CREATE EXTENSION IF NOT EXISTS)
 *   3. the pg_trgm extension installed (used by Slice 8 fuzzy address
 *      matching; created up front so the extension is available before
 *      any migration that depends on it)
 *   4. the role's default search_path set to `pinpoint, public` so every
 *      subsequent connection from this role (the app, drizzle-kit, psql)
 *      naturally resolves unqualified table references to the pinpoint
 *      schema without us having to prefix every pgTable call.
 *
 * Safe to re-run. Uses the same DATABASE_URL the app + drizzle-kit read.
 */
import postgres from 'postgres';

const DEFAULT_URL = 'postgresql://pinpoint:pinpoint@localhost:5433/pinpoint';
const SCHEMA = 'pinpoint';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? DEFAULT_URL;
  const sql = postgres(url, { onnotice: () => {} });

  try {
    const [{ current_user: role, current_database: database }] = await sql<
      { current_user: string; current_database: string }[]
    >`SELECT current_user, current_database()`;

    console.log(`[db:init] connected to ${database} as ${role}`);

    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    console.log(`[db:init] schema "${SCHEMA}" ready`);

    // PostGIS lives in whatever schema the role's search_path lists first
    // when the extension is created — but it's relocatable, so we pin it to
    // `public` so spatial functions (ST_*) stay namespace-free across all
    // app schemas that share this database. Pinpoint's tables stay in the
    // `pinpoint` schema; postgis functions stay in `public`.
    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public`);
    const [{ extversion }] = await sql<{ extversion: string }[]>`
      SELECT extversion FROM pg_extension WHERE extname = 'postgis'
    `;
    console.log(`[db:init] postgis extension ready (version ${extversion})`);

    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public`);
    const [{ extversion: trgmVersion }] = await sql<{ extversion: string }[]>`
      SELECT extversion FROM pg_extension WHERE extname = 'pg_trgm'
    `;
    console.log(`[db:init] pg_trgm extension ready (version ${trgmVersion})`);

    // Role default — applies to every future connection this role opens.
    // Includes `public` so postgis functions remain unqualified.
    await sql.unsafe(`ALTER ROLE "${role}" IN DATABASE "${database}" SET search_path TO "${SCHEMA}", public`);
    console.log(`[db:init] role ${role} default search_path → "${SCHEMA}", public`);

    console.log('[db:init] done');
  } finally {
    await sql.end({ timeout: 1 });
  }
}

main().catch((err) => {
  console.error('[db:init] failed:', err);
  process.exit(1);
});
