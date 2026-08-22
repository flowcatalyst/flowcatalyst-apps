/**
 * BFF location detail. Mirror of Rust `routes/bff/locations.rs::get_location`.
 *
 * Joins `location_feature_associations` so the SPA can render matched
 * features in the same payload — saves a roundtrip on the detail
 * screen. Features are sorted by layer name + feature label.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asLocationId } from '../../../../domain/locations/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';
import { BffLocationSummaryRef } from './location.schema.js';
import { BffFeatureAssociationRef } from './feature-association.schema.js';

const FeatureSchema = BffFeatureAssociationRef;

const ResponseSchema = Type.Intersect([
  BffLocationSummaryRef,
  Type.Object({
    /** Immutable received address (raw_address_line1). */
    receivedAddress: Type.String(),
    /** Editable match address that drives normalization + matching. */
    matchAddress: Type.String(),
    features: Type.Array(FeatureSchema),
  }),
]);

export function registerBffGetLocationRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/locations/:locationId',
    {
      schema: {
        operationId: 'bffGetLocation',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          locationId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: ResponseSchema,
          401: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { locationId } = request.params as { clientId: string; locationId: string };
      const location = await appContext.repositories.locations.findById(asLocationId(locationId));
      if (!location) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Location '${locationId}' not found.` });
      }

      const features = await appContext.repositories.layerFeatures.findFeatureAssociations(
        location.id,
      );

      return reply.code(200).send({
        id: location.id,
        name: location.name,
        partitionId: location.partitionId,
        address: location.rawAddressLine1,
        receivedAddress: location.rawAddressLine1,
        matchAddress: location.matchAddress,
        city: location.rawCity,
        country: location.rawCountry,
        status: location.status,
        masterLocationId: location.masterLocationId,
        matchConfidence: location.matchConfidence,
        matchMethod: location.matchMethod,
        createdAt: location.createdAt.toISOString(),
        features: [...features],
      });
    },
  );
}
