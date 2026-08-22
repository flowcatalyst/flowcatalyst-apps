import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { isFailure } from '@pinpoint/framework';
import { CreateClientCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const CreateClientBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  code: Type.String({ minLength: 1 }),
});

const CreateClientResponseSchema = Type.Object({
  clientId: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});

export function registerCreateClientRoute(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.post(
    '/clients',
    {
      schema: {
        operationId: 'createClient',
        tags: ['Tenancy'],
        body: CreateClientBodySchema,
        response: {
          201: CreateClientResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          409: ErrorResponseRef,
          500: ErrorResponseRef,
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

      const result = await appContext.runWrite(() =>
        appContext.useCases.createClient.execute(parsed.data),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      const data = event.getData();
      // `scope` is logged to silence the unused-var warning while we keep
      // the explicit 401 branch in place for the un-converted route surface.
      void scope;
      return reply.code(201).send({
        clientId: data.clientId,
        createdAt: event.time.toISOString(),
      });
    },
  );
}
