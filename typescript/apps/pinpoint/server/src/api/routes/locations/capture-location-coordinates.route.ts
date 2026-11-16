/**
 * POST /clients/:clientId/location-captures — a delivery vehicle reports the
 * coordinates it captured at an address (permission
 * `pinpoint:locations:capture:create`, e.g. the `delivery-capture` role).
 *
 * Creates a DRAFT master location there (address reverse-geocoded by Photon —
 * never Google — or the driver's line), to be completed by an operator. With
 * `address`, the client's location for it is found and, when the capture lands
 * further than max(50 m, 2 × accuracy) from it, flagged for review; its
 * coordinates are not changed.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import { CaptureLocationCoordinatesCommandSchema } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';
import type { Surface } from '../../plugins/surface.js';

const BodySchema = Type.Object({
  partitionId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
  /** GPS accuracy in metres, as the device reports it. */
  accuracyMeters: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
  /** When the capture was taken (ISO 8601); defaults to now. */
  capturedAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
  /** The address delivered to, free text. Omit when only the point is known. */
  address: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  /** Your reference for the capture (delivery / trip id). */
  reference: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
});

const ResponseSchema = Type.Object({
  /** The DRAFT master location created for the capture. */
  masterLocationId: Type.String(),
  status: Type.Literal('DRAFT'),
  /** The client's location matched by `address`, if any. */
  locationId: Type.Union([Type.String(), Type.Null()]),
  /** Distance from that location's coordinates, in metres. */
  distanceMeters: Type.Union([Type.Number(), Type.Null()]),
  /** True when the capture disagrees with the location (the location is flagged). */
  disagrees: Type.Boolean(),
});

export function registerCaptureLocationCoordinatesRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
  surface: Surface,
): void {
  fastify.post(
    `${surface.basePath}/clients/:clientId/location-captures`,
    {
      schema: {
        operationId: surface.operationId('captureLocationCoordinates'),
        tags: [surface.basePath ? 'BFF' : 'Locations'],
        summary: 'Report coordinates a delivery vehicle captured at an address.',
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        body: BodySchema,
        response: {
          201: ResponseSchema,
          400: ErrorResponseRef,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          500: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const parsed = CaptureLocationCoordinatesCommandSchema.safeParse({
        ...(request.body as object),
        clientId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', message: parsed.error.message });
      }
      const result = await appContext.runWrite(() =>
        appContext.useCases.captureLocationCoordinates.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      const data = result.value.getData();
      return reply.code(201).send({
        masterLocationId: data.masterLocationId,
        status: 'DRAFT' as const,
        locationId: data.locationId,
        distanceMeters: data.distanceMeters,
        disagrees: data.disagrees,
      });
    },
  );
}
