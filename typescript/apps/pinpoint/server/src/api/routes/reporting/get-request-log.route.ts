/** GET /request-logs/:id — one logged request with its request + response bodies. */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { PinpointPermission } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';
import {
  CANONICAL_SURFACE,
  type ReportingSurface,
  authorizePartitionAccess,
  isVisible,
} from './access.js';
import { RequestLogSummarySchema, toSummary } from './request-log.schema.js';

const RequestLogDetailSchema = Type.Intersect([
  RequestLogSummarySchema,
  Type.Object({
    /** The body as sent; `{ _truncated, bytes, head }` when over the size cap. */
    requestBody: Type.Unknown(),
    /** The body as returned; same truncation marker. */
    responseBody: Type.Unknown(),
  }),
]);

export function registerGetRequestLogRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
  surface: ReportingSurface = CANONICAL_SURFACE,
): void {
  fastify.get(
    `${surface.basePath}/request-logs/:id`,
    {
      schema: {
        operationId: surface.operationId('getRequestLog'),
        tags: ['Reporting'],
        summary: 'One logged request with its input and output.',
        params: Type.Object({ id: Type.String({ minLength: 1 }) }),
        response: {
          200: RequestLogDetailSchema,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const access = await authorizePartitionAccess(
        reply,
        appContext,
        PinpointPermission.ReportingRequestLogRead,
      );
      if (!access) return reply;
      const { id } = request.params as { id: string };
      const entry = await appContext.repositories.requestLogs.findById(id);
      // An invisible row is reported as missing — don't confirm it exists.
      if (!entry || !isVisible(access, entry)) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Request log '${id}' not found.` });
      }
      return reply.code(200).send({
        ...toSummary(entry),
        requestBody: entry.requestBody,
        responseBody: entry.responseBody,
      });
    },
  );
}
