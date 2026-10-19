/** GET /request-logs/:id — one logged request with its request + response bodies. */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { PinpointPermission } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';
import { authorizeReporting } from './access.js';
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

export function registerGetRequestLogRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get(
    '/request-logs/:id',
    {
      schema: {
        operationId: 'getRequestLog',
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
      if (!authorizeReporting(reply, PinpointPermission.ReportingRequestLogRead)) return reply;
      const { id } = request.params as { id: string };
      const entry = await appContext.repositories.requestLogs.findById(id);
      if (!entry) {
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
