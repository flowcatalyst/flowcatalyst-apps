import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ScopeAwareDrizzleLogger } from '@flowcatalyst-apps/app-framework';

/**
 * Default points at the dev container started by `pnpm db:up` (PostGIS-
 * enabled Postgres 18 on port 5433, see ../compose.yaml). The fc-dev
 * embedded postgres on 15432 doesn't ship with PostGIS, so pinpoint local
 * dev uses its own container.
 *
 * The `pinpoint` role's default search_path is set to `pinpoint, public`
 * by `pnpm db:init`, so unqualified table references resolve into the
 * `pinpoint` schema while postgis functions (ST_*, installed in `public`)
 * stay namespace-free.
 */
const connectionString =
  process.env['DATABASE_URL'] ?? 'postgresql://pinpoint:pinpoint@localhost:5433/pinpoint';

const sql = postgres(connectionString);

export const db = drizzle({ client: sql, logger: new ScopeAwareDrizzleLogger() });
