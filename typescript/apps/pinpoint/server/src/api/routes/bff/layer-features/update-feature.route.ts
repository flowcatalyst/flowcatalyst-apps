/**
 * BFF layer-feature update. Mirror of Rust
 * `routes/bff/layer_features.rs::update_feature`. Same POINT-layer
 * geometry-stripping rule as create.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { UpdateLayerFeatureCommandSchema } from '@pinpoint/shared';
import { asLayerFeatureId, asLayerId } from '../../../../domain/layers/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';
import { BffLayerFeatureRef, BffLayerFeatureInputRef } from './layer-feature.schema.js';

const BodySchema = BffLayerFeatureInputRef;

const ResponseSchema = BffLayerFeatureRef;

export function registerBffUpdateLayerFeatureRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.put(
    '/bff/clients/:clientId/layers/:layerId/features/:featureId',
    {
      schema: {
        operationId: 'bffUpdateFeature',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
          featureId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          200: ResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const { layerId, featureId } = request.params as {
        clientId: string;
        layerId: string;
        featureId: string;
      };
      const body = request.body as {
        label: string;
        centerLat?: number | null;
        centerLon?: number | null;
        radiusMeters?: number | null;
        polygonGeojson?: string | null;
        propertyValues?: Record<string, string>;
      };

      const layer = await appContext.repositories.layers.findById(asLayerId(layerId));
      const isPoint = layer?.layerType === 'POINT';

      const parsed = UpdateLayerFeatureCommandSchema.safeParse({
        featureId,
        label: body.label,
        centerLat: body.centerLat ?? null,
        centerLon: body.centerLon ?? null,
        radiusMeters: isPoint ? null : (body.radiusMeters ?? null),
        polygonGeojson: isPoint ? null : (body.polygonGeojson ?? null),
        propertyValues: body.propertyValues ?? {},
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.updateLayerFeature.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const feature = await appContext.repositories.layerFeatures.findById(
        asLayerFeatureId(featureId),
      );
      if (!feature) {
        return reply.code(500).send({
          error: 'InfrastructureError',
          message: `Feature '${featureId}' not found after update.`,
        });
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
