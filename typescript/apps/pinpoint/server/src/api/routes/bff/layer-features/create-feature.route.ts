/**
 * BFF layer-feature create. Mirror of Rust
 * `routes/bff/layer_features.rs::create_feature`.
 *
 * Special case: for POINT-typed parent layers the route nulls out
 * `radiusMeters` and `polygonGeojson` before forwarding. A POINT layer's
 * features carry only a center; a radius would buffer the point into a
 * polygon, which isn't the intent (matches Rust).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { CreateLayerFeatureCommandSchema } from '@pinpoint/shared';
import { asLayerFeatureId, asLayerId } from '../../../../domain/layers/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';
import { BffLayerFeatureRef, BffLayerFeatureInputRef } from './layer-feature.schema.js';

const BodySchema = BffLayerFeatureInputRef;

const ResponseSchema = BffLayerFeatureRef;

export function registerBffCreateLayerFeatureRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/layers/:layerId/features',
    {
      schema: {
        operationId: 'bffCreateFeature',
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          201: ResponseSchema,
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
      const { layerId } = request.params as { clientId: string; layerId: string };
      const body = request.body as {
        label: string;
        centerLat?: number | null;
        centerLon?: number | null;
        radiusMeters?: number | null;
        polygonGeojson?: string | null;
        propertyValues?: Record<string, string>;
      };

      // Check parent layer type — POINT layers reject radius/polygon.
      const layer = await appContext.repositories.layers.findById(asLayerId(layerId));
      if (!layer) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Layer '${layerId}' not found.` });
      }
      const isPoint = layer.layerType === 'POINT';

      const parsed = CreateLayerFeatureCommandSchema.safeParse({
        layerId,
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
        appContext.useCases.createLayerFeature.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const data = result.value.getData();
      const feature = await appContext.repositories.layerFeatures.findById(
        asLayerFeatureId(data.featureId),
      );
      if (!feature) {
        return reply.code(500).send({
          error: 'InfrastructureError',
          message: `Feature '${data.featureId}' not found after create.`,
        });
      }

      return reply.code(201).send({
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
