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
import { Result } from 'effect';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { CreateLayerFeatureCommandSchema } from '@pinpoint/shared';
import { asLayerFeatureId, asLayerId } from '../../../../domain/layers/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';

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

export function registerBffCreateLayerFeatureRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/layers/:layerId/features',
    {
      schema: {
        tags: ['BFF'],
        params: Type.Object({
          clientId: Type.String({ minLength: 1 }),
          layerId: Type.String({ minLength: 1 }),
        }),
        body: BodySchema,
        response: {
          201: ResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          500: ErrorSchema,
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
        return reply.code(404).send({ error: 'NotFound', message: `Layer '${layerId}' not found.` });
      }
      const isPoint = layer.layerType === 'POINT';

      const parsed = CreateLayerFeatureCommandSchema.safeParse({
        layerId,
        label: body.label,
        centerLat: body.centerLat ?? null,
        centerLon: body.centerLon ?? null,
        radiusMeters: isPoint ? null : body.radiusMeters ?? null,
        polygonGeojson: isPoint ? null : body.polygonGeojson ?? null,
        propertyValues: body.propertyValues ?? {},
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
        appContext.useCases.createLayerFeature.execute(parsed.data),
        scope,
      );
      if (Result.isFailure(result)) {
        return sendUseCaseError(reply, result.failure);
      }

      const data = result.success.event.getData();
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
