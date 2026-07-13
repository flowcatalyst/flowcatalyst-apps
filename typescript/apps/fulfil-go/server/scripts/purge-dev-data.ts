/**
 * Purge OPERATIONAL data from a dev database — the generator/smoke leftovers
 * (fulfilments, picks, transport orders/trips, logs, projections, queues).
 * REFERENCE data survives: stores, store profiles, printers, pickers,
 * client settings.
 *
 *   pnpm --filter @fulfil-go/server purge:dev-data              # everything
 *   pnpm --filter @fulfil-go/server purge:dev-data -- --client clt_XXX
 *   pnpm --filter @fulfil-go/server purge:dev-data -- --force   # non-local db
 *
 * Refuses non-local DATABASE_URLs unless --force — this is a dev tool, not
 * an ops tool. Short-id counters reset too, so part numbers start fresh.
 */
import postgres from 'postgres';

const DEFAULT_URL = 'postgresql://postgres:postgres@localhost:15432/fulfilgo';

/** Operational tables, delete order irrelevant (no FKs between them). */
const OPERATIONAL_TABLES = [
  'fulfilment_parts',
  'fulfilments',
  'picks',
  'pick_sessions',
  'transport_orders',
  'trips',
  'transport_positions',
  'process_reactions',
  'activity_log',
  'sync_events',
  'idempotency_keys',
  'telemetry_locations',
  'jobs',
  'short_id_counters',
  'audit_logs',
  'outbox_messages',
] as const;

/**
 * Tables with no client_id column. A full purge clears them; a --client
 * purge SKIPS them (deleting other tenants' rows from a scoped run would
 * surprise).
 */
const CLIENT_BLIND_TABLES = new Set([
  'audit_logs',
  'idempotency_keys',
  'outbox_messages',
  'sync_events',
  'telemetry_locations',
  'jobs',
]);

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? DEFAULT_URL;
  const clientId = argValue('--client');
  const force = process.argv.includes('--force');

  if (!/localhost|127\.0\.0\.1/.test(url) && !force) {
    console.error(`Refusing to purge a non-local database (${url.replace(/:[^@/]+@/, ':***@')}).`);
    console.error('Pass --force if you really mean it.');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  try {
    console.log(
      clientId
        ? `Purging operational data for client ${clientId}…`
        : 'Purging ALL operational data…',
    );
    for (const table of OPERATIONAL_TABLES) {
      const exists = await sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${table}`;
      if (exists.length === 0) {
        console.log(`  ${table}: (absent — skipped)`);
        continue;
      }
      if (clientId !== null && CLIENT_BLIND_TABLES.has(table)) {
        console.log(`  ${table}: (no client column — skipped; full purge clears it)`);
        continue;
      }
      const result =
        clientId !== null
          ? await sql`DELETE FROM ${sql(table)} WHERE client_id = ${clientId}`
          : await sql`DELETE FROM ${sql(table)}`;
      console.log(`  ${table}: ${result.count} rows`);
    }
    console.log('Done. Reference data (stores, profiles, printers, pickers, settings) untouched.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
