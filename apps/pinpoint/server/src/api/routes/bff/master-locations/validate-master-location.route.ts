/**
 * BFF master-location validate. Mirror of Rust
 * `routes/bff/master_locations.rs::validate_master_location`.
 *
 * Delegates to the existing `confirm-master-location` use case via
 * runWrite — that handles the * → VALIDATED transition + spatial
 * feature lookup + cascade to child locations + LocationValidated
 * event emission. Returns the BFF-shaped detail.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { ConfirmMasterLocationCommandSchema } from '@pinpoint/shared';
import { asMasterLocationId } from '../../../../domain/locations/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { toBffMasterLocationResponse } from './list-master-locations.route.js';
import { isFailure } from '@pinpoint/framework';

const ResponseSchema = Type.Object({
  id: Type.String(),
  address: Type.String(),
  houseNumber: Type.Union([Type.String(), Type.Null()]),
  road: Type.Union([Type.String(), Type.Null()]),
  suburb: Type.Union([Type.String(), Type.Null()]),
  city: Type.String(),
  state: Type.Union([Type.String(), Type.Null()]),
  postalCode: Type.Union([Type.String(), Type.Null()]),
  country: Type.String(),
  status: Type.String(),
  latitude: Type.Union([Type.Number(), Type.Null()]),
  longitude: Type.Union([Type.Number(), Type.Null()]),
  addressHash: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
});

export function registerBffValidateMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/master-locations/:masterLocationId/validate',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: ResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          500: ErrorSchema,
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
        return reply.code(400).send({ error: 'ValidationError' });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.confirmMasterLocation.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const ml = await appContext.repositories.masterLocations.findById(
        asMasterLocationId(masterLocationId),
      );
      if (!ml) {
        return reply.code(500).send({
          error: 'InfrastructureError',
          message: `Master location '${masterLocationId}' not found after validate.`,
        });
      }
      return reply.code(200).send(toBffMasterLocationResponse(ml));
    },
  );
}
