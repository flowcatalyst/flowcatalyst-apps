import { Type } from '@sinclair/typebox';
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { CreateClientCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';

const CreateClientBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  code: Type.String({ minLength: 1 }),
});

const CreateClientResponseSchema = Type.Object({
  clientId: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerCreateClientRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/clients',
    {
      schema: {
        tags: ['Tenancy'],
        body: CreateClientBodySchema,
        response: {
          201: CreateClientResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = CreateClientCommandSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(
        appContext.useCases.createClient.execute(parsed.data),
        scope,
      );

      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }

      const event = result.success.event;
      const data = event.getData();
      return reply.code(201).send({
        clientId: data.clientId,
        createdAt: event.time.toISOString(),
      });
    },
  );
}
