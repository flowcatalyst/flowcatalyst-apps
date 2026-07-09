import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@fulfil-go/framework';
import {
  CancelFulfilmentCommandSchema,
  CreateFulfilmentCommandSchema,
  CreateFulfilmentResponseSchema,
  FulfilmentDtoSchema,
} from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { asFulfilmentId } from '../../../domain/fulfilments/ids.js';
import { toFulfilmentDto } from '../../../domain/fulfilments/fulfilment-dto.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { ErrorResponseSchema, UnauthorizedSchema, WRITE_RESPONSES } from '../../schemas/common.js';

/**
 * Tenant-scoped fulfilment routes (pinpoint convention: clientId in the
 * path, injected into the command; per-client claim enforcement is a scope
 * concern parked with the tenancy plumbing).
 */
export function registerFulfilmentRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.post(
    '/clients/:clientId/fulfilments',
    {
      schema: {
        tags: ['Fulfilments'],
        params: Type.Object({ clientId: Type.String() }),
        body: Type.Any(),
        response: {
          201: CreateFulfilmentResponseSchema,
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      const parsed = CreateFulfilmentCommandSchema.safeParse({
        ...(request.body as object | null),
        clientId: (request.params as { clientId: string }).clientId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.createFulfilment.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      appContext.sseBroker.nudge();

      const data = result.value.getData();
      return reply.code(201).send({
        fulfilmentId: data.fulfilmentId,
        parts: data.parts,
        createdAt: result.value.time.toISOString(),
      });
    },
  );

  fastify.post(
    '/clients/:clientId/fulfilments/:fulfilmentId/cancel',
    {
      schema: {
        tags: ['Fulfilments'],
        params: Type.Object({ clientId: Type.String(), fulfilmentId: Type.String() }),
        body: Type.Optional(Type.Object({ reason: Type.Optional(Type.String()) })),
        response: {
          200: Type.Object({ fulfilmentId: Type.String(), status: Type.String() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { clientId: string; fulfilmentId: string };
      const parsed = CancelFulfilmentCommandSchema.safeParse({
        ...(request.body as object | null),
        clientId: params.clientId,
        fulfilmentId: params.fulfilmentId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.cancelFulfilment.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      appContext.sseBroker.nudge();

      return reply
        .code(200)
        .send({ fulfilmentId: result.value.getData().fulfilmentId, status: 'cancelled' });
    },
  );

  fastify.get(
    '/clients/:clientId/fulfilments',
    {
      schema: {
        tags: ['Fulfilments'],
        params: Type.Object({ clientId: Type.String() }),
        querystring: Type.Object({
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
        }),
        response: {
          200: Type.Object({ fulfilments: Type.Array(FulfilmentDtoSchema) }),
          401: UnauthorizedSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const { limit, offset } = request.query as { limit?: number; offset?: number };
      const rows = await appContext.repositories.fulfilments.listByClient(
        clientId,
        limit ?? 50,
        offset ?? 0,
      );
      return reply.code(200).send({ fulfilments: rows.map(toFulfilmentDto) });
    },
  );

  fastify.get(
    '/clients/:clientId/fulfilments/:fulfilmentId/processing-log',
    {
      schema: {
        tags: ['Fulfilments'],
        params: Type.Object({ clientId: Type.String(), fulfilmentId: Type.String() }),
        response: {
          200: Type.Object({
            entries: Type.Array(
              Type.Object({
                id: Type.Number(),
                at: Type.String(),
                actor: Type.String(),
                category: Type.String(),
                message: Type.String(),
                data: Type.Union([Type.Any(), Type.Null()]),
              }),
            ),
          }),
          401: UnauthorizedSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { fulfilmentId } = request.params as { clientId: string; fulfilmentId: string };
      const entries = await appContext.repositories.fulfilmentLog.list(fulfilmentId);
      return reply.code(200).send({
        entries: entries.map((e) => ({
          id: e.id,
          at: e.at.toISOString(),
          actor: e.actor,
          category: e.category,
          message: e.message,
          data: e.data ?? null,
        })),
      });
    },
  );

  fastify.get(
    '/clients/:clientId/fulfilments/:fulfilmentId',
    {
      schema: {
        tags: ['Fulfilments'],
        params: Type.Object({ clientId: Type.String(), fulfilmentId: Type.String() }),
        response: {
          200: FulfilmentDtoSchema,
          401: UnauthorizedSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, fulfilmentId } = request.params as {
        clientId: string;
        fulfilmentId: string;
      };
      const fulfilment = await appContext.repositories.fulfilments.findById(
        clientId,
        asFulfilmentId(fulfilmentId),
      );
      if (!fulfilment) {
        return reply.code(404).send({
          error: 'not_found',
          code: 'FULFILMENT_NOT_FOUND',
          message: `Fulfilment '${fulfilmentId}' does not exist for this client.`,
          details: null,
        });
      }
      return reply.code(200).send(toFulfilmentDto(fulfilment));
    },
  );
}
