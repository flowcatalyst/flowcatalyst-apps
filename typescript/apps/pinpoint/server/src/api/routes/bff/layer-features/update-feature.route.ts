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

const BodySchema = Type.Object({
  label: Type.String({ minLength: 1 }),
  centerLat: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  centerLon: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  radiusMeters: Type.Optional(Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()])),
  polygonGeojson: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  propertyValues: Type.Optional(Type.Record(Type.String(), Type.String())),
});

const ResponseSchema = Type.Object({
  id: Type.String(),
  layerId: Type.String(),
  label: Type.String(),
  centerLat: Type.Union([Type.Number(), Type.Null()]),
  centerLon: Type.Union([Type.Number(), Type.Null()]),
  radiusMeters: Type.Union([Type.Number(), Type.Null()]),
  polygonGeojson: Type.Union([Type.String(), Type.Null()]),
  propertyValues: Type.Record(Type.String(), Type.String()),
  status: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
  issues: Type.Optional(Type.Array(Type.Unknown())),
});

export function registerBffUpdateLayerFeatureRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.put(
    '/bff/clients/:clientId/layers/:layerId/features/:featureId',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
          featureId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          200: ResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          500: ErrorSchema,
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
