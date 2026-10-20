/**
 * GET /reports/usage — request counts per client / partition / operation,
 * bucketed by month (default), week (ISO, Monday start) or day.
 *
 * Built from `request_logs`, so it counts API requests (the canonical
 * surface — not the SPA's BFF). `errors` is the subset answered 4xx / 5xx.
 * Without `from`, the window opens on a whole period: the last 12 months,
 * 12 weeks or 31 days, the current one included.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { PinpointPermission } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import type {
  RequestSurface,
  UsagePeriod,
} from '../../../domain/reporting/request-log.repository.js';
import { RequestSurfaceSchema } from './request-log.schema.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';
import {
  CANONICAL_SURFACE,
  type ReportingSurface,
  authorizePartitionAccess,
  isValidTimezone,
  visibilityOf,
} from './access.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);

const UsageQuerySchema = Type.Object({
  period: Type.Optional(
    Type.Union([Type.Literal('month'), Type.Literal('week'), Type.Literal('day')], {
      default: 'month',
    }),
  ),
  /** Inclusive window start (ISO date-time). */
  from: Type.Optional(Type.String({ format: 'date-time' })),
  /** Exclusive window end (ISO date-time). Default: now. */
  to: Type.Optional(Type.String({ format: 'date-time' })),
  /** IANA zone the period boundaries are cut in. Default UTC. */
  timezone: Type.Optional(Type.String({ minLength: 1, default: 'UTC' })),
  clientId: Type.Optional(Type.String({ minLength: 1 })),
  partitionId: Type.Optional(Type.String({ minLength: 1 })),
  /** Narrow to one operationId, e.g. `createLocation`. */
  operation: Type.Optional(Type.String({ minLength: 1 })),
  /** Narrow to requests from the API or the UI. */
  surface: Type.Optional(RequestSurfaceSchema),
});

const UsageReportSchema = Type.Object({
  period: Type.String(),
  timezone: Type.String(),
  from: Type.String({ format: 'date-time' }),
  to: Type.String({ format: 'date-time' }),
  rows: Type.Array(
    Type.Object({
      /** Period start as a local date in `timezone` (YYYY-MM-DD). */
      periodStart: Type.String(),
      clientId: NullableString,
      clientCode: NullableString,
      partitionId: NullableString,
      partitionCode: NullableString,
      operation: Type.String(),
      surface: RequestSurfaceSchema,
      requests: Type.Integer(),
      errors: Type.Integer(),
    }),
  ),
});

export function registerUsageReportRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
  surface: ReportingSurface = CANONICAL_SURFACE,
): void {
  fastify.get(
    `${surface.basePath}/reports/usage`,
    {
      schema: {
        operationId: surface.operationId('getUsageReport'),
        tags: ['Reporting'],
        summary: 'Request counts per client / partition / operation / period.',
        querystring: UsageQuerySchema,
        response: {
          200: UsageReportSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const q = request.query as {
        period?: UsagePeriod;
        from?: string;
        to?: string;
        timezone?: string;
        clientId?: string;
        partitionId?: string;
        operation?: string;
        surface?: RequestSurface;
      };
      const access = await authorizePartitionAccess(
        reply,
        appContext,
        PinpointPermission.ReportingUsageRead,
        q,
      );
      if (!access) return reply;
      const period = q.period ?? 'month';
      const timezone = q.timezone ?? 'UTC';
      if (!isValidTimezone(timezone)) {
        return reply
          .code(400)
          .send({ error: 'ValidationError', message: `Unknown timezone '${timezone}'.` });
      }

      const report = await appContext.repositories.requestLogs.usage({
        visibleTo: visibilityOf(access),
        period,
        timezone,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        clientId: q.clientId,
        partitionId: q.partitionId,
        operation: q.operation,
        surface: q.surface,
      });
      return reply.code(200).send({
        period,
        timezone,
        from: report.from.toISOString(),
        to: report.to.toISOString(),
        rows: [...report.rows],
      });
    },
  );
}
