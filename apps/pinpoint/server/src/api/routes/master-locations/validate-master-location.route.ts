/**
 * POST /master-locations/:id/validate — geocode a PENDING master location.
 *
 * Despite the verb, this is the geocoding step (PENDING → GEOCODED).
 * `confirm-master-location` handles the actual canonical-validation step.
 * Naming preserved for parity with the Rust pinpoint.
 */
import { Type } from '@sinclair/typebox';
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { ValidateMasterLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';

const ValidateResponseSchema = Type.Object({
  masterLocationId: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number(),
  confidence: Type.Number(),
  formattedAddress: Type.Union([Type.String(), Type.Null()]),
  geocodedAt: Type.String({ format: 'date-time' }),
});

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerValidateMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/master-locations/:id/validate',
    {
      schema: {
        tags: ['MasterLocations'],
        params: Type.Object({ id: Type.String({ minLength: 1 }) }),
        response: {
          200: ValidateResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = ValidateMasterLocationCommandSchema.safeParse({ masterLocationId: id });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(
        appContext.useCases.validateMasterLocation.execute(parsed.data),
        scope,
      );
      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }

      const event = result.success.event;
      const data = event.getData();
      return reply.code(200).send({
        masterLocationId: data.masterLocationId,
        latitude: data.latitude,
        longitude: data.longitude,
        confidence: data.confidence,
        formattedAddress: data.formattedAddress,
        geocodedAt: event.time.toISOString(),
      });
    },
  );
}
