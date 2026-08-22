/**
 * BFF layer-feature detail. Mirror of Rust
 * `routes/bff/layer_features.rs::get_feature`.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asLayerFeatureId } from '../../../../domain/layers/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';
import { BffLayerFeatureRef } from './layer-feature.schema.js';

const ResponseSchema = BffLayerFeatureRef;

export function registerBffGetLayerFeatureRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/layers/:layerId/features/:featureId',
    {
      schema: {
        operationId: 'bffGetFeature',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
          featureId: Type.String({ minLength: 1 }),
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

      const { featureId } = request.params as {
        clientId: string;
        layerId: string;
        featureId: string;
      };
      const feature = await appContext.repositories.layerFeatures.findById(
        asLayerFeatureId(featureId),
      );
      if (!feature) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Feature '${featureId}' not found.` });
      }

      return reply.code(200).send({
        id: feature.id,
        layerId: feature.layerId,
        label: feature.label,
        centerLat: feature.centerLat,
        centerLon: feature.centerLon,
        radiusMeters: feature.radiusMeters,
        polygonGeojson: feature.polygonGeojson,
        propertyValues: feature.propertyValues as Record<string, string>,
        status: feature.status,
        createdAt: feature.createdAt.toISOString(),
        updatedAt: feature.updatedAt.toISOString(),
      });
    },
  );
}
