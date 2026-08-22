import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { CreateLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const NullableString = Type.Optional(Type.Union([Type.String(), Type.Null()]));

const CreateLocationParamsSchema = Type.Object({
  clientId: Type.String({ minLength: 1 }),
});

/**
 * Slice 8 shape: free-form `address` plus an optional ISO-A3 `countryCode`
 * retry hint. The libpostal sidecar (see compose.yaml) parses the address
 * inside the use case; `raw_*` columns get filled from the parsed
 * components, not from caller-structured fields. The Slice 3 shape is gone.
 */
const AttributeValueSchema = Type.Union([Type.String(), Type.Array(Type.String())]);

const AttributeInputSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  value: AttributeValueSchema,
});

const CreateLocationBodySchema = Type.Object({
  partitionId: NullableString,
  externalId: NullableString,
  name: NullableString,
  address: Type.String({ minLength: 1 }),
  countryCode: Type.Optional(
    Type.Union([Type.String({ minLength: 2, maxLength: 3 }), Type.Null()]),
  ),
  attributes: Type.Optional(Type.Array(AttributeInputSchema)),
});

const CreateLocationResponseSchema = Type.Object({
  locationId: Type.String(),
  masterLocationId: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});

export function registerCreateLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/clients/:clientId/locations',
    {
      schema: {
        operationId: 'createLocation',
        tags: ['Locations'],
        params: CreateLocationParamsSchema,
        body: CreateLocationBodySchema,
        response: {
          201: CreateLocationResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          409: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { clientId } = request.params as { clientId: string };
      const parsed = CreateLocationCommandSchema.safeParse({
        ...(request.body as object),
        clientId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.createLocation.execute(parsed.data),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      const data = event.getData();
      return reply.code(201).send({
        locationId: data.locationId,
        masterLocationId: data.masterLocationId ?? '',
        createdAt: event.time.toISOString(),
      });
    },
  );
}
