/**
 * POST /bff/clients/:clientId/master-locations/:masterLocationId/confirm-geocode
 *
 * Operator confirms address components + coordinates (after reverse-geocode or
 * manual entry): confirm-master-location-geocode applies them (→ GEOCODED,
 * emits `master_location:geocode-confirmed`), then confirm-master-location
 * canonicalises the master (→ VALIDATED, cascades to the child locations).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import {
  ConfirmMasterLocationCommandSchema,
  ConfirmMasterLocationGeocodeCommandSchema,
} from '@pinpoint/shared';
import { asMasterLocationId } from '../../../../domain/locations/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { toBffMasterLocationResponse } from './list-master-locations.route.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';
import { BffMasterLocationRef } from './master-location.schema.js';

const BodySchema = Type.Object({
  houseNumber: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  road: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  suburb: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  city: Type.String({ minLength: 1 }),
  state: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  postalCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  country: Type.String({ minLength: 1 }),
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
});
const ResponseSchema = BffMasterLocationRef;

export function registerBffConfirmGeocodeRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/master-locations/:masterLocationId/confirm-geocode',
    {
      schema: {
        operationId: 'bffConfirmGeocode',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          200: ResponseSchema,
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
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, masterLocationId } = request.params as {
        clientId: string;
        masterLocationId: string;
      };
      const body = request.body as Record<string, unknown>;

      const geocodeCmd = ConfirmMasterLocationGeocodeCommandSchema.safeParse({
        clientId,
        masterLocationId,
        ...body,
      });
      if (!geocodeCmd.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: geocodeCmd.error.issues });
      }
      const geocoded = await appContext.runWrite(() =>
        appContext.useCases.confirmMasterLocationGeocode.execute(geocodeCmd.data),
      );
      if (isFailure(geocoded)) return sendUseCaseError(reply, geocoded.error);

      const confirmCmd = ConfirmMasterLocationCommandSchema.safeParse({
        clientId,
        masterLocationId,
      });
      if (!confirmCmd.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: confirmCmd.error.issues });
      }
      const confirmed = await appContext.runWrite(() =>
        appContext.useCases.confirmMasterLocation.execute(confirmCmd.data),
      );
      if (isFailure(confirmed)) return sendUseCaseError(reply, confirmed.error);

      const ml = await appContext.repositories.masterLocations.findById(
        asMasterLocationId(masterLocationId),
      );
      if (!ml) {
        return reply.code(500).send({
          error: 'InfrastructureError',
          message: `Master location '${masterLocationId}' not found after confirm.`,
        });
      }
      return reply.code(200).send(toBffMasterLocationResponse(ml));
    },
  );
}
