/**
 * BFF layer create. Mirror of Rust `routes/bff/layers.rs::create_layer`.
 *
 * Body uses Rust's BFF field names (`radius`, `geometry`) which differ
 * from the canonical CreateLayerCommand (`radiusMeters`, `polygonGeojson`)
 * — preserved for SPA contract compatibility. Adapted here before
 * dispatching to the use case via runWrite.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { CreateLayerCommandSchema } from '@pinpoint/shared';
import { asLayerId } from '../../../../domain/layers/ids.js';
import type { AppContext } from '../../../../app-context.js';
import { BffLayerDetailResponseRef } from './layer-response.schema.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';
import { isFailure } from '@pinpoint/framework';
import { ErrorResponseRef } from '../../../plugins/error-response.schema.js';

const BodySchema = Type.Object({
  code: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  layerType: Type.Union([Type.Literal('RADIUS'), Type.Literal('POLYGON'), Type.Literal('POINT')]),
  centerLat: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  centerLon: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  radius: Type.Optional(Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()])),
  geometry: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const ResponseSchema = BffLayerDetailResponseRef;

export function registerBffCreateLayerRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients/:clientId/layers',
    {
      schema: {
        operationId: 'bffCreateLayer',
        tags: ['BFF'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
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
      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        code: string;
        name: string;
        description?: string | null;
        layerType: 'RADIUS' | 'POLYGON' | 'POINT';
        centerLat?: number | null;
        centerLon?: number | null;
        radius?: number | null;
        geometry?: string | null;
      };
      // Adapt Rust BFF's `radius`/`geometry` field names to the canonical
      // CreateLayerCommand shape (`radiusMeters`/`polygonGeojson`).
      const parsed = CreateLayerCommandSchema.safeParse({
        clientId,
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        layerType: body.layerType,
        centerLat: body.centerLat ?? null,
        centerLon: body.centerLon ?? null,
        radiusMeters: body.radius ?? null,
        polygonGeojson: body.geometry ?? null,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }

      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.createLayer.execute(parsed.data),
      );
      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      const data = result.value.getData();
      const layer = await appContext.repositories.layers.findById(asLayerId(data.layerId));
      if (!layer) {
        return reply.code(500).send({
          error: 'InfrastructureError',
          message: `Layer '${data.layerId}' not found after create.`,
        });
      }

      return reply.code(201).send({
        id: layer.id,
        code: layer.code,
        name: layer.name,
        description: layer.description,
        layerType: layer.layerType,
        status: layer.status,
        centerLat: layer.centerLat,
        centerLon: layer.centerLon,
        radiusMeters: layer.radiusMeters,
        polygonGeojson: layer.polygonGeojson,
        propertySets: [],
        partitionIds: [],
        createdAt: layer.createdAt.toISOString(),
      });
    },
  );
}
