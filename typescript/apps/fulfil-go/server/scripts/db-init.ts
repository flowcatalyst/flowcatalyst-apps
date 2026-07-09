/**
 * Idempotent local-dev DB bootstrap for fulfil-go.
 *
 * Works against either local Postgres option (see .env.example):
 *   - the docker container from `pnpm db:up` (port 5434), or
 *   - fc-dev's embedded Postgres (port 15432) — start the platform first.
 *
 * Ensures:
 *   0. the target DATABASE itself exists (created via the server's
 *      `postgres` maintenance db — matters on the shared embedded instance,
 *      where fulfil-go owns a `fulfilgo` db alongside the platform's)
 *   1. the `public` schema (CREATE SCHEMA IF NOT EXISTS)
 *   2. the role's default search_path pinned
 *   3. the SDK-owned outbox_messages table (ships as a standalone .sql,
 *      not in the Drizzle journal — every commitAggregate writes to it)
 *
 * Safe to re-run. Uses the same DATABASE_URL the app + drizzle-kit read.
 */
import postgres from 'postgres';
import { applyOutboxTableMigration } from '../src/infrastructure/migrate.js';

const DEFAULT_URL = 'postgresql://fulfilgo:fulfilgo@localhost:5434/fulfilgo';
const SCHEMA = 'public';

/**
 * Create the target database when absent, via the same server's `postgres`
 * maintenance db. Non-fatal on permission errors — a provisioned-for-us
 * database (docker container, prod) already exists and this step no-ops.
 */
async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, '')) || 'fulfilgo';
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const sql = postgres(admin.toString(), { onnotice: () => {}, max: 1 });
  try {
    const [row] = await sql<{ one: number }[]>`
      SELECT 1 AS one FROM pg_database WHERE datname = ${dbName}
    `;
    if (row) {
      console.log(`[db:init] database "${dbName}" already exists`);
    } else {
      await sql.unsafe(`CREATE DATABASE "${dbName}"`);
      console.log(`[db:init] database "${dbName}" created`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[db:init] could not ensure database exists (continuing): ${message}`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? DEFAULT_URL;
  await ensureDatabase(url);
  const sql = postgres(url, { onnotice: () => {} });

  try {
    const [{ current_user: role, current_database: database }] = await sql<
      { current_user: string; current_database: string }[]
    >`SELECT current_user, current_database()`;

    console.log(`[db:init] connected to ${database} as ${role}`);

    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    console.log(`[db:init] schema "${SCHEMA}" ready`);

    await sql.unsafe(
      `ALTER ROLE "${role}" IN DATABASE "${database}" SET search_path TO "${SCHEMA}", public`,
    );
    console.log(`[db:init] role ${role} default search_path → "${SCHEMA}", public`);

    const createdOutbox = await applyOutboxTableMigration(sql, SCHEMA);
    console.log(
      createdOutbox
        ? `[db:init] outbox_messages table created in "${SCHEMA}"`
        : `[db:init] outbox_messages already present`,
    );

    console.log('[db:init] done');
  } finally {
    await sql.end({ timeout: 1 });
  }
}

main().catch((err) => {
  console.error('[db:init] failed:', err);
  process.exit(1);
});
