/**
 * One row per API request: who called which operation for which client /
 * partition, what was sent, what came back, and how it went. Written by the
 * `request-log` Fastify plugin after the response is sent; read by the usage
 * report and the request-log inspection routes.
 *
 * Deliberately no FKs: a log row must outlive the client, partition or
 * principal it names (deleting a client must not erase its billing history).
 * Pruned by the `pinpoint-prune-request-logs` scheduled job.
 */
import { index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from '@flowcatalyst-apps/app-framework';

export const requestLogs = pgTable(
  'request_logs',
  {
    id: text('id').primaryKey(),
    createdAt: timestampColumn('created_at').notNull().defaultNow(),
    clientId: text('client_id'),
    partitionId: text('partition_id'),
    principalId: text('principal_id'),
    /** The route's OpenAPI operationId, e.g. `createLocation`. */
    operation: text('operation').notNull(),
    method: text('method').notNull(),
    /** Route pattern, e.g. `/clients/:clientId/locations`. */
    route: text('route').notNull(),
    /** Actual request URL, query string included. */
    url: text('url').notNull(),
    statusCode: integer('status_code').notNull(),
    durationMs: integer('duration_ms').notNull(),
    requestBody: jsonb('request_body'),
    responseBody: jsonb('response_body'),
  },
  (t) => [
    index('idx_request_logs_created').on(t.createdAt),
    index('idx_request_logs_client_created').on(t.clientId, t.createdAt),
  ],
);

export type NewRequestLog = typeof requestLogs.$inferInsert;
export type RequestLogRow = typeof requestLogs.$inferSelect;
