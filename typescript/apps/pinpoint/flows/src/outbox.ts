import postgres from 'postgres';
import type { Report } from './report.js';

/**
 * Look at the pinpoint DB's outbox for events written since the run started:
 * proves the write path emitted them, and shows whether the fc-dev outbox
 * poller is picking them up (status 0 = still pending).
 */
export async function observeOutbox(r: Report, databaseUrl: string, since: Date): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql<{ type: string; n: string; pending: string }[]>`
      SELECT payload::jsonb->>'type' AS type, count(*) AS n,
             count(*) FILTER (WHERE status = 0) AS pending
      FROM outbox_messages
      WHERE type = 'EVENT' AND created_at >= ${since}
      GROUP BY 1 ORDER BY 1`;
    if (rows.length === 0) {
      r.expect(false, 'no outbox rows since the run started (is DATABASE_URL the server’s DB?)');
      return;
    }
    let total = 0,
      pending = 0;
    for (const row of rows) {
      total += Number(row.n);
      pending += Number(row.pending);
      r.note(
        `${row.type.padEnd(58)} ${String(row.n).padStart(3)}  ${Number(row.pending) > 0 ? `(${row.pending} pending)` : ''}`,
      );
    }
    r.expect(total > 0, `${total} domain events written through the outbox`);
    if (pending === total)
      r.skip(
        'all events still pending — start the fc-dev outbox poller to see them dispatched to the platform',
      );
    else r.note(`${total - pending}/${total} dispatched by the outbox poller`);
  } finally {
    await sql.end();
  }
}
