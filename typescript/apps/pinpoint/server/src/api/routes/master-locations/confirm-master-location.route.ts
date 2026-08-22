/**
 * POST /clients/:clientId/master-locations/:masterLocationId/confirm — mark
 * a GEOCODED master_location as VALIDATED. Cascades LocationValidated
 * to every non-validated child `locations` row + writes per-child
 * `location_feature_associations` from the master's coordinate.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { ConfirmMasterLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';

const ConfirmResponseSchema = Type.Object({
  masterLocationId: Type.String(),
  locationsValidated: Type.Integer({ minimum: 0 }),
  featuresMatched: Type.Integer({ minimum: 0 }),
  validatedAt: Type.String({ format: 'date-time' }),
});

export function registerConfirmMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/clients/:clientId/master-locations/:masterLocationId/confirm',
    {
      schema: {
        operationId: 'confirmMasterLocation',
        tags: ['MasterLocations'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        // No body — clientId is in the path now.
        response: {
          200: ConfirmResponseSchema,
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
      const { clientId, masterLocationId } = request.params as {
        clientId: string;
        masterLocationId: string;
      };
      const parsed = ConfirmMasterLocationCommandSchema.safeParse({
        clientId,
        masterLocationId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.confirmMasterLocation.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const event = result.value;
      const data = event.getData();
      return reply.code(200).send({
        masterLocationId: data.masterLocationId,
        locationsValidated: data.locationsValidated,
        featuresMatched: data.featuresMatched,
        validatedAt: event.time.toISOString(),
      });
    },
  );
}
