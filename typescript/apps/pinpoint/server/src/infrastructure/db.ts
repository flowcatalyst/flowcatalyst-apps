import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ScopeAwareDrizzleLogger } from '@flowcatalyst-apps/app-framework';

/**
 * Pinpoint's tables live in a Postgres schema named `pinpoint` (not `public`).
 *
 * Locally, `pnpm db:init` sets the dev role's default search_path. In prod we
 * share the platform's RDS instance + master role, so we must NOT touch that
 * role's default search_path (it's used by other apps too). Instead we set
 * search_path PER CONNECTION via the startup parameter below — every pooled
 * connection lands on `pinpoint, public`, with `public` kept on the path so
 * postgis / pg_trgm functions (ST_*, similarity) resolve unqualified.
 */
export const DB_SCHEMA = process.env['PINPOINT_DB_SCHEMA'] ?? 'pinpoint';
const SEARCH_PATH = `${DB_SCHEMA}, public`;

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
 *      injects DB_PASSWORD from the RDS-managed Secrets Manager secret and the
 *      rest as plain env (reusing the shared `flowcatalyst` DB + master role).
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
      database: process.env['DB_NAME'] ?? 'flowcatalyst',
      username: process.env['DB_USER'] ?? 'inhance_admin',
      password: process.env['DB_PASSWORD'] ?? '',
      ...base,
    });
  }

  return postgres('postgresql://pinpoint:pinpoint@localhost:5433/pinpoint', base);
}

const sql = makeSql();

export const db = drizzle({ client: sql, logger: new ScopeAwareDrizzleLogger() });
