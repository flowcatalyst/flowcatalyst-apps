import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ScopeAwareDrizzleLogger } from '@fulfil-go/framework';

/**
 * fulfil-go owns a dedicated `fulfilgo` database with its tables in the
 * `public` schema. FULFILGO_DB_SCHEMA (default `public`) exists only as an
 * escape hatch if the DB ever has to be shared; leave it unset. search_path
 * is pinned per connection via the startup parameter so behaviour is
 * deterministic regardless of any role-level default.
 */
export const DB_SCHEMA = process.env['FULFILGO_DB_SCHEMA'] ?? 'public';
const SEARCH_PATH = DB_SCHEMA === 'public' ? 'public' : `${DB_SCHEMA}, public`;

function resolveSsl(): 'require' | { rejectUnauthorized: boolean } | undefined {
  // RDS requires TLS. FULFILGO_DB_SSL=require verifies the chain; =no-verify
  // skips verification. Unset = no TLS (local container).
  const v = (process.env['FULFILGO_DB_SSL'] ?? '').toLowerCase();
  if (v === 'require' || v === 'true' || v === '1') return 'require';
  if (v === 'no-verify') return { rejectUnauthorized: false };
  return undefined;
}

/**
 * Build a postgres-js client. Connection source, in priority order:
 *   1. DATABASE_URL — local/dev + drizzle-kit parity.
 *   2. discrete DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD — prod shape.
 *   3. the local dev container fallback (matches `pnpm db:up`).
 *
 * `opts.max` lets callers (e.g. the migrator) cap the pool size.
 */
export function makeSql(opts: { max?: number } = {}) {
  const ssl = resolveSsl();
  const base = {
    connection: { search_path: SEARCH_PATH },
    ...(ssl ? { ssl } : {}),
    ...(opts.max != null ? { max: opts.max } : {}),
  };

  const url = process.env['DATABASE_URL'];
  if (url) {
    return postgres(url, base);
  }

  const host = process.env['DB_HOST'];
  if (host) {
    const [hostname, hostPort] = host.split(':');
    return postgres({
      host: hostname,
      port: Number(process.env['DB_PORT'] ?? hostPort ?? 5432),
      database: process.env['DB_NAME'] ?? 'fulfilgo',
      username: process.env['DB_USER'] ?? 'fulfilgo_server',
      password: process.env['DB_PASSWORD'] ?? '',
      ...base,
    });
  }

  return postgres('postgresql://fulfilgo:fulfilgo@localhost:5434/fulfilgo', base);
}

const sql = makeSql();

export const db = drizzle({ client: sql, logger: new ScopeAwareDrizzleLogger() });

/** Raw postgres-js client — LISTEN/NOTIFY needs it (drizzle has no surface for it). */
export const sqlClient = sql;
