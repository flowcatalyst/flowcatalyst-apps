import { Type } from '@sinclair/typebox';
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { CreateLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';

const NullableString = Type.Optional(Type.Union([Type.String(), Type.Null()]));

const CreateLocationBodySchema = Type.Object({
  clientId: Type.String({ minLength: 1 }),
  partitionId: NullableString,
  externalId: NullableString,
  name: NullableString,
  rawAddressLine1: Type.String({ minLength: 1 }),
  rawAddressLine2: NullableString,
  rawSuburb: NullableString,
  rawCity: Type.String({ minLength: 1 }),
  rawState: NullableString,
  rawPostalCode: NullableString,
  rawCountry: Type.String({ minLength: 1 }),
});

const CreateLocationResponseSchema = Type.Object({
  locationId: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerCreateLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/locations',
    {
      schema: {
        tags: ['Locations'],
        body: CreateLocationBodySchema,
        response: {
          201: CreateLocationResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = CreateLocationCommandSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(
        appContext.useCases.createLocation.execute(parsed.data),
        scope,
      );

      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }

      const event = result.success.event;
      const data = event.getData();
      return reply.code(201).send({
        locationId: data.locationId,
        createdAt: event.time.toISOString(),
      });
    },
  );
}
