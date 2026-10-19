/**
 * GET /request-logs — logged API requests, newest first, without bodies
 * (fetch one by id for its input + output). Defaults to the last 7 days.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { PinpointPermission } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';
import { authorizeReporting } from './access.js';
import { RequestLogSummarySchema, toSummary } from './request-log.schema.js';

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const ListQuerySchema = Type.Object({
  from: Type.Optional(Type.String({ format: 'date-time' })),
  to: Type.Optional(Type.String({ format: 'date-time' })),
  clientId: Type.Optional(Type.String({ minLength: 1 })),
  partitionId: Type.Optional(Type.String({ minLength: 1 })),
  operation: Type.Optional(Type.String({ minLength: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

const ListResponseSchema = Type.Object({
  entries: Type.Array(RequestLogSummarySchema),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
});

export function registerListRequestLogsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/request-logs',
    {
      schema: {
        operationId: 'listRequestLogs',
        tags: ['Reporting'],
        summary: 'Logged API requests, newest first (bodies omitted).',
        querystring: ListQuerySchema,
        response: { 200: ListResponseSchema, 401: ErrorResponseRef, 403: ErrorResponseRef },
      },
    },
    async (request, reply) => {
      if (!authorizeReporting(reply, PinpointPermission.ReportingRequestLogRead)) return reply;
      const q = request.query as {
        from?: string;
        to?: string;
        clientId?: string;
        partitionId?: string;
        operation?: string;
        limit?: number;
        offset?: number;
      };
      const to = q.to ? new Date(q.to) : undefined;
      const from = q.from
        ? new Date(q.from)
        : new Date((to ?? new Date()).getTime() - DEFAULT_WINDOW_MS);
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;
      const page = await appContext.repositories.requestLogs.list({
        from,
        to,
        clientId: q.clientId,
        partitionId: q.partitionId,
        operation: q.operation,
        limit,
        offset,
      });
      return reply.code(200).send({
        entries: page.entries.map(toSummary),
        total: page.total,
        limit,
        offset,
      });
    },
  );
}
