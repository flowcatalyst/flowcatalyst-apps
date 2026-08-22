/**
 * POST /clients/:clientId/master-locations/:masterLocationId/validate
 * — geocode a PENDING master location.
 *
 * Despite the verb, this is the geocoding step (PENDING → GEOCODED).
 * `confirm-master-location` handles the actual canonical-validation step.
 * Naming preserved for parity with the Rust pinpoint.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { ValidateMasterLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const ValidateResponseSchema = Type.Object({
  masterLocationId: Type.String(),
  latitude: Type.Number(),
  longitude: Type.Number(),
  confidence: Type.Number(),
  formattedAddress: Type.Union([Type.String(), Type.Null()]),
  geocodedAt: Type.String({ format: 'date-time' }),
});

export function registerValidateMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/clients/:clientId/master-locations/:masterLocationId/validate',
    {
      schema: {
        operationId: 'validateMasterLocation',
        tags: ['MasterLocations'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: ValidateResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          409: ErrorResponseRef,
          500: ErrorResponseRef,
          502: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { masterLocationId } = request.params as {
        clientId: string;
        masterLocationId: string;
      };
      const parsed = ValidateMasterLocationCommandSchema.safeParse({ masterLocationId });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.validateMasterLocation.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
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
