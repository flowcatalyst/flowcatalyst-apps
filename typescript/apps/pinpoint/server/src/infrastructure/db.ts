import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ScopeAwareDrizzleLogger } from '@flowcatalyst-apps/app-framework';

/**
 * Pinpoint owns a dedicated `pinpoint` database with its tables in the `public`
 * schema — it does NOT share a database or sit in a named schema. postgis /
 * pg_trgm are installed in that database's `public` schema, so table refs and
 * spatial functions (ST_*, similarity) both resolve unqualified with the
 * default search_path.
 *
 * PINPOINT_DB_SCHEMA (default `public`) exists only as an escape hatch if the DB
 * ever has to be shared; leave it unset. We still pin search_path per connection
 * via the startup parameter so behaviour is deterministic regardless of any
 * role-level default.
 */
export const DB_SCHEMA = process.env['PINPOINT_DB_SCHEMA'] ?? 'public';
const SEARCH_PATH = DB_SCHEMA === 'public' ? 'public' : `${DB_SCHEMA}, public`;

function resolveSsl(): 'require' | { rejectUnauthorized: boolean } | undefined {
  // RDS requires TLS. PINPOINT_DB_SSL=require verifies the chain (needs the
  // RDS CA in the trust store); =no-verify skips verification (simplest for
  // the managed RDS endpoint). Unset = no TLS (local container).
  const v = (process.env['PINPOINT_DB_SSL'] ?? '').toLowerCase();
  if (v === 'require' || v === 'true' || v === '1') return 'require';
  if (v === 'no-verify') return { rejectUnauthorized: false };
  return undefined;
}

/**
 * Build a postgres-js client. Connection source, in priority order:
 *   1. DATABASE_URL — local/dev + drizzle-kit parity.
 *   2. discrete DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD — prod, where ECS
 *      injects DB_PASSWORD from a Secrets Manager secret and the rest as plain
 *      env. Pinpoint connects to its OWN `pinpoint` database as its OWN
 *      `pinpoint_server` role with a static (non-rotated) password.
 *   3. the local dev container fallback (matches `pnpm db:up`).
 *
 * `opts.max` lets callers (e.g. the migrator) cap the pool size.
 */
export function makeSql(opts: { max?: number } = {}) {
  const ssl = resolveSsl();
  const base = {
    // search_path is a USERSET GUC, accepted in the startup packet — applies
    // to every connection in the pool without an ALTER ROLE.
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
    // The RDS `endpoint` output is `host:port`; split if a port is appended.
    const [hostname, hostPort] = host.split(':');
    return postgres({
      host: hostname,
      port: Number(process.env['DB_PORT'] ?? hostPort ?? 5432),
      database: process.env['DB_NAME'] ?? 'pinpoint',
      username: process.env['DB_USER'] ?? 'pinpoint_server',
      password: process.env['DB_PASSWORD'] ?? '',
      ...base,
    });
  }

  return postgres('postgresql://pinpoint:pinpoint@localhost:5433/pinpoint', base);
}

const sql = makeSql();

export const db = drizzle({ client: sql, logger: new ScopeAwareDrizzleLogger() });
