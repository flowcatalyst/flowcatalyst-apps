/**
 * BFF location create. Mirror of Rust `routes/bff/locations.rs::create_location`.
 *
 * Body is a subset of the canonical CreateLocationCommand — no
 * `attributes[]` (Rust BFF always passes empty), and no `clientId`
 * (path param). Delegates to the existing `create-location` use case
 * via `runWrite`; re-reads the location after commit to return the
 * BFF-shaped detail (matches Rust response shape).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { CreateLocationCommandSchema } from '@pinpoint/shared';
import { asLocationId } from '../../../../domain/locations/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const BodySchema = Type.Object({
  partitionId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  externalId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  address: Type.String({ minLength: 1 }),
  countryCode: Type.Optional(
    Type.Union([Type.String({ minLength: 2, maxLength: 3 }), Type.Null()]),
  ),
});

const ResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
  address: Type.String(),
  city: Type.String(),
  country: Type.String(),
  status: Type.String(),
  masterLocationId: Type.Union([Type.String(), Type.Null()]),
  matchConfidence: Type.Union([Type.Number(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});

export function registerBffCreateLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/locations',
    {
      schema: {
        operationId: 'bffCreateLocation',
        tags: ['BFF'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        body: BodySchema,
        response: {
          201: ResponseSchema,
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
        attributes: [],
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

      const data = result.value.getData();
      const location = await appContext.repositories.locations.findById(
        asLocationId(data.locationId),
      );
      if (!location) {
        return reply.code(500).send({
          error: 'InfrastructureError',
          message: `Location '${data.locationId}' not found after create.`,
        });
      }

      return reply.code(201).send({
        id: location.id,
        name: location.name,
        address: location.rawAddressLine1,
        city: location.rawCity,
        country: location.rawCountry,
        status: location.status,
        masterLocationId: location.masterLocationId,
        matchConfidence: location.matchConfidence,
        createdAt: location.createdAt.toISOString(),
      });
    },
  );
}
