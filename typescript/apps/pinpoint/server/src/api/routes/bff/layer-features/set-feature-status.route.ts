/**
 * PUT /bff/clients/:clientId/layers/:layerId/features/:featureId/status
 * Activate / deactivate a feature via the set-layer-feature-status use case
 * (emits `pinpoint:layers:feature:status-changed`).
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { SetLayerFeatureStatusCommandSchema } from '@pinpoint/shared';
import { asLayerFeatureId } from '../../../../domain/layers/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';
import { BffLayerFeatureRef } from './layer-feature.schema.js';

const BodySchema = Type.Object({
  status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('INACTIVE')]),
});
const ResponseSchema = BffLayerFeatureRef;

export function registerBffSetFeatureStatusRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.put(
    '/bff/clients/:clientId/layers/:layerId/features/:featureId/status',
    {
      schema: {
        operationId: 'bffSetFeatureStatus',
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
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const params = request.params as { clientId: string; layerId: string; featureId: string };
      const { status } = request.body as { status: 'ACTIVE' | 'INACTIVE' };
      const parsed = SetLayerFeatureStatusCommandSchema.safeParse({ ...params, status });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.setLayerFeatureStatus.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);

      const feature = await appContext.repositories.layerFeatures.findById(
        asLayerFeatureId(params.featureId),
      );
      if (!feature) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Feature '${params.featureId}' not found.` });
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
