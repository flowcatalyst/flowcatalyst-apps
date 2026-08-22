/**
 * Operator-triggered feature (re)association:
 *   POST /bff/clients/:clientId/master-locations/:masterLocationId/match-features  (one master)
 *   POST /bff/clients/:clientId/master-locations/match-features                    (every master of the client)
 * Both go through the match-master-location-features use case — one
 * transaction + one `pinpoint:locations:master_location:features-matched`
 * event per master. Bulk skips masters without coordinates.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { MatchMasterLocationFeaturesCommandSchema } from '@pinpoint/shared';
import { asClientId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const MatchedFeatureSchema = Type.Object({
  layerFeatureId: Type.String(),
  layerId: Type.String(),
  layerName: Type.String(),
  featureLabel: Type.String(),
  distanceMeters: Type.Union([Type.Number(), Type.Null()]),
});
const SingleResponseSchema = Type.Object({
  masterLocationId: Type.String(),
  locationsUpdated: Type.Integer({ minimum: 0 }),
  featuresMatched: Type.Array(MatchedFeatureSchema),
});
const BulkResponseSchema = Type.Object({
  mastersProcessed: Type.Integer({ minimum: 0 }),
  totalAssociations: Type.Integer({ minimum: 0 }),
});

const BULK_LIMIT = 10_000;

export function registerBffMatchFeaturesRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  // Single-master re-match
  fastify.post(
    '/bff/clients/:clientId/master-locations/:masterLocationId/match-features',
    {
      schema: {
        operationId: 'bffMatchFeatures',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: SingleResponseSchema,
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
      const parsed = MatchMasterLocationFeaturesCommandSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      const result = await appContext.runWrite(() =>
        appContext.useCases.matchMasterLocationFeatures.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);

      const data = result.value.getData();
      return reply.code(200).send({
        masterLocationId: data.masterLocationId,
        locationsUpdated: data.locationsUpdated,
        featuresMatched: data.features.map((f) => ({
          layerFeatureId: f.layerFeatureId,
          layerId: f.layerId,
          layerName: f.layerName,
          featureLabel: f.featureLabel,
          distanceMeters: f.distanceMeters,
        })),
      });
    },
  );

  // Bulk re-match: every master under the client that has coords.
  fastify.post(
    '/bff/clients/:clientId/master-locations/match-features',
    {
      schema: {
        operationId: 'bffMatchFeaturesBulk',
        tags: ['BFF'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        response: {
          200: BulkResponseSchema,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const { masters } = await appContext.repositories.masterLocations.listByClient({
        clientId: asClientId(clientId),
        limit: BULK_LIMIT,
        offset: 0,
      });

      let mastersProcessed = 0;
      let totalAssociations = 0;
      for (const master of masters) {
        if (master.latitude == null || master.longitude == null) continue;
        const result = await appContext.runWrite(() =>
          appContext.useCases.matchMasterLocationFeatures.execute({
            clientId,
            masterLocationId: master.id,
          }),
        );
        // The permission check fails identically for every master — surface it
        // once instead of silently processing nothing.
        if (isFailure(result) && result.error.type === 'authorization') {
          return sendUseCaseError(reply, result.error);
        }
        if (isFailure(result)) continue;
        const data = result.value.getData();
        mastersProcessed += 1;
        totalAssociations += data.features.length * data.locationsUpdated;
      }

      return reply.code(200).send({ mastersProcessed, totalAssociations });
    },
  );
}
