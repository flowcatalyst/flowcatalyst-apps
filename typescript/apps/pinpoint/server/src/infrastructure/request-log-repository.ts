import { and, count, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  DEFAULT_USAGE_PERIODS,
  type NewRequestLogEntry,
  type RequestLogEntry,
  type RequestLogFilter,
  type RequestLogPage,
  type RequestLogRepository,
  type UsageQuery,
  type UsageReport,
} from '../domain/reporting/request-log.repository.js';
import { clients } from './schema/clients.js';
import { partitions } from './schema/partitions.js';
import { requestLogs, type RequestLogRow } from './schema/request-logs.js';

const REQUEST_LOG_ID_PREFIX = 'rql';

function where(filter: RequestLogFilter): SQL | undefined {
  return and(
    gte(requestLogs.createdAt, filter.from),
    filter.to ? lt(requestLogs.createdAt, filter.to) : undefined,
    filter.clientId ? eq(requestLogs.clientId, filter.clientId) : undefined,
    filter.partitionId ? eq(requestLogs.partitionId, filter.partitionId) : undefined,
    filter.operation ? eq(requestLogs.operation, filter.operation) : undefined,
  );
}

function toEntry(row: RequestLogRow): RequestLogEntry {
  return {
    id: row.id,
    createdAt: row.createdAt,
    clientId: row.clientId,
    partitionId: row.partitionId,
    principalId: row.principalId,
    operation: row.operation,
    method: row.method,
    route: row.route,
    url: row.url,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    requestBody: row.requestBody,
    responseBody: row.responseBody,
  };
}

/**
 * Start of the period `DEFAULT_USAGE_PERIODS[period] - 1` periods before the
 * current one, cut in the query's timezone and returned as an instant.
 */
async function defaultWindowStart(db: PostgresJsDatabase, query: UsageQuery): Promise<Date> {
  const back = `${DEFAULT_USAGE_PERIODS[query.period] - 1} ${query.period}`;
  const [row] = await db.execute<{ start: Date | string }>(
    sql`select ((date_trunc(${query.period}, now() at time zone ${query.timezone}) - ${back}::interval) at time zone ${query.timezone}) as start`,
  );
  return new Date(row!.start);
}

/**
 * Writes go straight to the pool, never through a bound transaction: the log
 * row is written after the response, and must survive a rolled-back use case.
 */
export function createDrizzleRequestLogRepository(db: PostgresJsDatabase): RequestLogRepository {
  return {
    async record(entry: NewRequestLogEntry): Promise<void> {
      await db.insert(requestLogs).values({
        id: `${REQUEST_LOG_ID_PREFIX}_${generateTsid()}`,
        ...entry,
      });
    },

    async usage(query: UsageQuery): Promise<UsageReport> {
      const from = query.from ?? (await defaultWindowStart(db, query));
      const local = sql`(${requestLogs.createdAt} AT TIME ZONE ${query.timezone})`;
      const periodStart = sql<string>`to_char(date_trunc(${query.period}, ${local}), 'YYYY-MM-DD')`;
      const rows = await db
        .select({
          periodStart,
          clientId: requestLogs.clientId,
          clientCode: clients.code,
          partitionId: requestLogs.partitionId,
          partitionCode: partitions.code,
          operation: requestLogs.operation,
          requests: sql<number>`count(*)::int`,
          errors: sql<number>`(count(*) filter (where ${requestLogs.statusCode} >= 400))::int`,
        })
        .from(requestLogs)
        .leftJoin(clients, eq(clients.id, requestLogs.clientId))
        .leftJoin(partitions, eq(partitions.id, requestLogs.partitionId))
        .where(where({ ...query, from }))
        // By position: every repetition of the period expression gets its own
        // bind parameters, so Postgres can't match a repeated expression to
        // the selected one.
        .groupBy(sql`1`, sql`2`, sql`3`, sql`4`, sql`5`, sql`6`)
        .orderBy(sql`1`, sql`3 nulls last`, sql`5 nulls last`, sql`6`);
      return { from, to: query.to ?? new Date(), rows };
    },

    async list(filter): Promise<RequestLogPage> {
      const condition = where(filter);
      const [rows, totals] = await Promise.all([
        db
          .select({
            id: requestLogs.id,
            createdAt: requestLogs.createdAt,
            clientId: requestLogs.clientId,
            partitionId: requestLogs.partitionId,
            principalId: requestLogs.principalId,
            operation: requestLogs.operation,
            method: requestLogs.method,
            route: requestLogs.route,
            url: requestLogs.url,
            statusCode: requestLogs.statusCode,
            durationMs: requestLogs.durationMs,
          })
          .from(requestLogs)
          .where(condition)
          .orderBy(desc(requestLogs.createdAt), desc(requestLogs.id))
          .limit(filter.limit)
          .offset(filter.offset),
        db.select({ total: count() }).from(requestLogs).where(condition),
      ]);
      return { entries: rows, total: totals[0]?.total ?? 0 };
    },

    async findById(id: string): Promise<RequestLogEntry | null> {
      const [row] = await db.select().from(requestLogs).where(eq(requestLogs.id, id)).limit(1);
      return row ? toEntry(row) : null;
    },

    async pruneBefore(cutoff: Date): Promise<number> {
      // Row count from the driver rather than RETURNING: a large backlog would
      // otherwise pull every deleted id into memory.
      const result = await db.execute(
        sql`delete from ${requestLogs} where ${requestLogs.createdAt} < ${cutoff.toISOString()}::timestamptz`,
      );
      return result.count;
    },
  };
}
