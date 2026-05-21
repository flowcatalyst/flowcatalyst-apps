/**
 * BFF master-location update. Mirror of Rust
 * `routes/bff/master_locations.rs::update_master_location`.
 *
 * Adapts Rust BFF's non-prefixed body field names (`houseNumber`, `road`,
 * `suburb`, ...) to the canonical UpdateMasterLocationCommand
 * (`normalizedHouseNumber`, etc.). Delegates to the existing
 * update-master-location use case via runWrite (Slice 10b.1); the use
 * case recomputes `addressHash` + `normalizedAddressLine` from the new
 * components, then re-reads and returns the BFF-shaped detail.
 */
import { Type } from '@sinclair/typebox';
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdateMasterLocationCommandSchema } from '@pinpoint/shared';
import { asMasterLocationId } from '../../../../domain/locations/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { toBffMasterLocationResponse } from './list-master-locations.route.js';

const BodySchema = Type.Object({
  houseNumber: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  road: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  suburb: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  city: Type.String({ minLength: 1 }),
  state: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  postalCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  country: Type.String({ minLength: 1 }),
});

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
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerBffUpdateMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.put(
    '/bff/clients/:clientId/master-locations/:masterLocationId',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          200: ResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { clientId, masterLocationId } = request.params as {
        clientId: string;
        masterLocationId: string;
      };
      const body = request.body as {
        houseNumber?: string | null;
        road?: string | null;
        suburb?: string | null;
        city: string;
        state?: string | null;
        postalCode?: string | null;
        country: string;
      };
      const parsed = UpdateMasterLocationCommandSchema.safeParse({
        clientId,
        masterLocationId,
        normalizedHouseNumber: body.houseNumber ?? null,
        normalizedRoad: body.road ?? null,
        normalizedSuburb: body.suburb ?? null,
        normalizedCity: body.city,
        normalizedState: body.state ?? null,
        normalizedPostalCode: body.postalCode ?? null,
        normalizedCountry: body.country,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(
        appContext.useCases.updateMasterLocation.execute(parsed.data),
        scope,
      );
      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }

      const updated = await appContext.repositories.masterLocations.findById(
        asMasterLocationId(masterLocationId),
      );
      if (!updated) {
        return reply.code(500).send({
          error: 'InfrastructureError',
          message: `Master location '${masterLocationId}' not found after update.`,
        });
      }
      return reply.code(200).send(toBffMasterLocationResponse(updated));
    },
  );
}
