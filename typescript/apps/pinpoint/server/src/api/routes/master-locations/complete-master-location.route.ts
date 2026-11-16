/**
 * POST {base}/clients/:clientId/master-locations/:masterLocationId/complete —
 * capture a DRAFT master's address properly (it came from a delivery capture):
 * DRAFT → VALIDATED, usable for matching. Mounted on both surfaces.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { CompleteMasterLocationCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { asMasterLocationId } from '../../../domain/locations/ids.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';
import type { Surface } from '../../plugins/surface.js';
import { BffMasterLocationRef } from '../bff/master-locations/master-location.schema.js';
import { toBffMasterLocationResponse } from '../bff/master-locations/list-master-locations.route.js';

const NullableString = Type.Optional(Type.Union([Type.String(), Type.Null()]));

const BodySchema = Type.Object({
  name: NullableString,
  houseNumber: NullableString,
  road: NullableString,
  suburb: NullableString,
  city: Type.String({ minLength: 1 }),
  state: NullableString,
  postalCode: NullableString,
  country: Type.String({ minLength: 1 }),
});

export function registerCompleteMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
  surface: Surface,
): void {
  fastify.post(
    `${surface.basePath}/clients/:clientId/master-locations/:masterLocationId/complete`,
    {
      schema: {
        operationId: surface.operationId('completeMasterLocation'),
        tags: [surface.basePath ? 'BFF' : 'MasterLocations'],
        summary: "Capture a DRAFT master location's address: DRAFT → VALIDATED.",
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          200: BffMasterLocationRef,
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
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, masterLocationId } = request.params as {
        clientId: string;
        masterLocationId: string;
      };
      const b = request.body as Record<string, string | null | undefined>;
      const parsed = CompleteMasterLocationCommandSchema.safeParse({
        clientId,
        masterLocationId,
        name: b['name'] ?? null,
        normalizedHouseNumber: b['houseNumber'] ?? null,
        normalizedRoad: b['road'] ?? null,
        normalizedSuburb: b['suburb'] ?? null,
        normalizedCity: b['city'],
        normalizedState: b['state'] ?? null,
        normalizedPostalCode: b['postalCode'] ?? null,
        normalizedCountry: b['country'],
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', message: parsed.error.message });
      }
      const result = await appContext.runWrite(() =>
        appContext.useCases.completeMasterLocation.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      const master = await appContext.repositories.masterLocations.findById(
        asMasterLocationId(masterLocationId),
      );
      return reply.code(200).send(toBffMasterLocationResponse(master!));
    },
  );
}
