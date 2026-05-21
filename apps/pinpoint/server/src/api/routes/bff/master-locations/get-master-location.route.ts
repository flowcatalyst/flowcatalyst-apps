/**
 * BFF master-location detail. Mirror of Rust
 * `routes/bff/master_locations.rs::get_master_location`. Includes the
 * feature associations from the first child location (matches Rust —
 * all child locations share the same set of associations once the
 * master is VALIDATED).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asMasterLocationId } from '../../../../domain/locations/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { toBffMasterLocationResponse } from './list-master-locations.route.js';

const FeatureSchema = Type.Object({
  layerFeatureId: Type.String(),
  layerId: Type.String(),
  layerName: Type.String(),
  featureLabel: Type.String(),
  distanceMeters: Type.Union([Type.Number(), Type.Null()]),
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
  features: Type.Array(FeatureSchema),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerBffGetMasterLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/master-locations/:masterLocationId',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        response: { 200: ResponseSchema, 401: ErrorSchema, 404: ErrorSchema, 500: ErrorSchema },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { masterLocationId } = request.params as {
        clientId: string;
        masterLocationId: string;
      };
      const mid = asMasterLocationId(masterLocationId);
      const master = await appContext.repositories.masterLocations.findById(mid);
      if (!master) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Master location '${masterLocationId}' not found.`,
        });
      }

      // Feature associations live on locations, not masters. The set is
      // identical across all child locations of a VALIDATED master, so
      // we just read from the first child.
      const children = await appContext.repositories.locations.listByMaster(mid);
      const features =
        children.length > 0
          ? await appContext.repositories.layerFeatures.findFeatureAssociations(children[0]!.id)
          : [];

      return reply.code(200).send({
        ...toBffMasterLocationResponse(master),
        features: features.map((f) => ({ ...f })),
      });
    },
  );
}
