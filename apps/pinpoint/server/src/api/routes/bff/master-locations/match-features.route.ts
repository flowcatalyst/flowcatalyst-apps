/**
 * BFF master-location match-features routes. Mirror of Rust
 * `routes/bff/master_locations.rs::{match_features, bulk_match_features}`.
 *
 * Two endpoints registered here:
 *   - POST /bff/clients/:cid/master-locations/match-features
 *     (bulk: re-match every master under the client that has coords)
 *   - POST /bff/clients/:cid/master-locations/:mlid/match-features
 *     (single: re-match one master)
 *
 * Both operator-tool repairs: the matching pipeline already runs
 * spatial-lookup automatically on the canonical VALIDATED transition,
 * so these endpoints exist for re-running after a layer's boundary
 * geometry changes (or after data corrections that need fan-out).
 *
 * Bulk caps at `BULK_LIMIT` masters. Larger backlogs should use the
 * Slice 9 scheduled validation worker, not this endpoint.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asClientId } from '../../../../domain/tenancy/ids.js';
import { asMasterLocationId } from '../../../../domain/locations/ids.js';
import type { MasterLocation } from '../../../../domain/locations/master-location.js';
import type { FeatureAssociation } from '../../../../domain/layers/layer-feature.repository.js';
import type { AppContext } from '../../../../app-context.js';

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

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
});

const BULK_LIMIT = 10_000;

async function matchOneMaster(
  appContext: AppContext,
  master: MasterLocation,
): Promise<{ matches: readonly FeatureAssociation[]; locationsUpdated: number } | null> {
  if (master.latitude == null || master.longitude == null) return null;

  const matches = await appContext.repositories.layerFeatures.findFeaturesContainingPoint({
    clientId: master.clientId,
    partitionId: master.partitionId,
    latitude: master.latitude,
    longitude: master.longitude,
  });

  const children = await appContext.repositories.locations.listByMaster(master.id);
  for (const loc of children) {
    await appContext.repositories.layerFeatures.replaceLocationFeatureAssociations(
      loc.id,
      matches.map((m) => ({
        layerId: m.layerId,
        featureId: m.layerFeatureId,
        distanceMeters: m.distanceMeters,
      })),
    );
  }
  return { matches, locationsUpdated: children.length };
}

export function registerBffMatchFeaturesRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  // Single-master re-match
  fastify.post(
    '/bff/clients/:clientId/master-locations/:masterLocationId/match-features',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          masterLocationId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: SingleResponseSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          500: ErrorSchema,
        },
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
      const master = await appContext.repositories.masterLocations.findById(
        asMasterLocationId(masterLocationId),
      );
      if (!master) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Master location '${masterLocationId}' not found.`,
        });
      }
      if (master.latitude == null || master.longitude == null) {
        return reply.code(409).send({
          error: 'BusinessRuleViolation',
          code: 'NO_COORDINATES',
          message: 'Master location has no coordinates — geocode it first.',
        });
      }

      const result = await matchOneMaster(appContext, master);
      // result is non-null here because we just validated lat/lon above
      const { matches, locationsUpdated } = result ?? { matches: [], locationsUpdated: 0 };

      return reply.code(200).send({
        masterLocationId: master.id,
        locationsUpdated,
        featuresMatched: matches.map((m) => ({
          layerFeatureId: m.layerFeatureId,
          layerId: m.layerId,
          layerName: m.layerName,
          featureLabel: m.featureLabel,
          distanceMeters: m.distanceMeters,
        })),
      });
    },
  );

  // Bulk re-match: every master under the client that has coords.
  fastify.post(
    '/bff/clients/:clientId/master-locations/match-features',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        response: { 200: BulkResponseSchema, 401: ErrorSchema, 500: ErrorSchema },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
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
        const result = await matchOneMaster(appContext, master);
        if (result == null) continue;
        mastersProcessed += 1;
        totalAssociations += result.matches.length * result.locationsUpdated;
      }

      return reply.code(200).send({ mastersProcessed, totalAssociations });
    },
  );
}
