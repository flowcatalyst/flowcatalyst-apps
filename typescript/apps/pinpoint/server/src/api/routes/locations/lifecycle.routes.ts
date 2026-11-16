/**
 * A location's own geocode + approval lifecycle, mounted on both surfaces
 * (canonical under `/clients/:clientId/locations/:locationId/…`, the SPA under
 * `/bff/…`): geocode, approve, confirm an operator geocode (then approve),
 * reject, re-match features, dismiss a delivery-capture disagreement, a
 * Photon reverse-geocode suggestion, and the processing trail. Every action
 * answers with the location as it now is (`LocationDetail`).
 *
 * Plus the cross-client review queue (`GET {base}/locations/review-queue`):
 * locations waiting for a person — PENDING, GEOCODED but not auto-approved,
 * or flagged by a delivery capture — limited to what the caller may see.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ScopeStore, UseCaseError, isFailure, type Result } from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';
import type { AppContext } from '../../../app-context.js';
import { asLocationId } from '../../../domain/locations/ids.js';
import type { Location } from '../../../domain/locations/location.js';
import { asClientId, asPartitionId } from '../../../domain/tenancy/ids.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { ErrorResponseRef } from '../../plugins/error-response.schema.js';
import type { Surface } from '../../plugins/surface.js';
import { authorizePartitionAccess } from '../reporting/access.js';
import { LocationDetailRef, LocationDetailSchema, toLocationDetail } from './location-detail.schema.js';

const Params = Type.Object({
  clientId: Type.String({ minLength: 1 }),
  locationId: Type.String({ minLength: 1 }),
});
type ParamsT = { clientId: string; locationId: string };

const ActionResponses = {
  200: LocationDetailRef,
  400: ErrorResponseRef,
  401: ErrorResponseRef,
  403: ErrorResponseRef,
  404: ErrorResponseRef,
  409: ErrorResponseRef,
  422: ErrorResponseRef,
  500: ErrorResponseRef,
  502: ErrorResponseRef,
};

const ConfirmGeocodeBody = Type.Object({
  houseNumber: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  road: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  suburb: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  city: Type.String({ minLength: 1 }),
  state: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  postalCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  country: Type.String({ minLength: 1 }),
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
});

const ReverseGeocodeResponse = Type.Object({
  houseNumber: Type.Union([Type.String(), Type.Null()]),
  road: Type.Union([Type.String(), Type.Null()]),
  suburb: Type.Union([Type.String(), Type.Null()]),
  city: Type.String(),
  state: Type.Union([Type.String(), Type.Null()]),
  postalCode: Type.Union([Type.String(), Type.Null()]),
  country: Type.String(),
  formattedAddress: Type.String(),
  confidence: Type.Number(),
});

const TrailEntry = Type.Object({
  id: Type.String(),
  step: Type.String(),
  data: Type.Unknown(),
  createdAt: Type.String({ format: 'date-time' }),
});

const ReviewQuery = Type.Object({
  /** Comma-separated client ids. */
  clientIds: Type.Optional(Type.String()),
  /** Comma-separated partition ids. */
  partitionIds: Type.Optional(Type.String()),
  reason: Type.Optional(
    Type.Union([
      Type.Literal('PENDING'),
      Type.Literal('GEOCODED'),
      Type.Literal('CAPTURE_DISAGREES'),
    ]),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export function registerLocationLifecycleRoutes(
  fastify: FastifyInstance,
  appContext: AppContext,
  surface: Surface,
): void {
  const base = `${surface.basePath}/clients/:clientId/locations/:locationId`;
  const tags = [surface.basePath ? 'BFF' : 'Locations'];

  async function respond(reply: FastifyReply, locationId: string) {
    const location = await appContext.repositories.locations.findById(asLocationId(locationId));
    if (!location) {
      return reply.code(404).send({ error: 'NotFound', message: `Location '${locationId}' not found.` });
    }
    const features = await appContext.repositories.layerFeatures.findFeatureAssociations(location.id);
    return reply.code(200).send(toLocationDetail(location, features));
  }

  function action(
    name: string,
    operation: string,
    summary: string,
    run: (params: ParamsT, body: unknown) => Promise<Result<unknown>>,
    body?: ReturnType<typeof Type.Object>,
  ) {
    fastify.post(
      `${base}/${name}`,
      {
        schema: {
          operationId: surface.operationId(operation),
          tags,
          summary,
          params: Params,
          ...(body ? { body } : {}),
          response: ActionResponses,
        },
      },
      async (request, reply) => {
        if (!ScopeStore.get()) {
          return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
        }
        const params = request.params as ParamsT;
        const result = await appContext.runWrite(() => run(params, request.body ?? {}));
        if (isFailure(result)) return sendUseCaseError(reply, result.error);
        return respond(reply, params.locationId);
      },
    );
  }

  const uc = appContext.useCases;
  action('geocode', 'geocodeLocation', 'Geocode a PENDING location (Photon, Google Maps fallback).', (p) =>
    uc.geocodeLocation.execute(p),
  );
  action(
    'approve',
    'approveLocation',
    'Approve a GEOCODED location: features, VALIDATED; our own geocodes also become a master location.',
    (p) => uc.approveLocation.execute(p),
  );
  action(
    'confirm-geocode',
    'confirmLocationGeocode',
    'An operator confirms the coordinates + address (source OPERATOR), then the location is approved.',
    async (p, body) => {
      const confirmed = await uc.confirmLocationGeocode.execute({
        ...p,
        ...(body as Record<string, unknown>),
      } as never);
      if (isFailure(confirmed)) return confirmed;
      return uc.approveLocation.execute(p);
    },
    ConfirmGeocodeBody,
  );
  action(
    'reject',
    'rejectLocation',
    'Reject a location (not a real or deliverable place).',
    (p, body) =>
      uc.rejectLocation.execute({ ...p, reason: (body as { reason?: string | null }).reason ?? null }),
    Type.Object({ reason: Type.Optional(Type.Union([Type.String(), Type.Null()])) }),
  );
  action('match-features', 'matchLocationFeatures', 'Re-run the spatial feature match at the location.', (p) =>
    uc.matchLocationFeatures.execute(p),
  );
  action('clear-capture-review', 'clearLocationCaptureReview', 'Dismiss a delivery-capture disagreement.', (p) =>
    uc.clearLocationCaptureReview.execute(p),
  );

  // Photon reverse geocode at the location's point — a suggestion, nothing written.
  fastify.post(
    `${base}/reverse-geocode`,
    {
      schema: {
        operationId: surface.operationId('reverseGeocodeLocation'),
        tags,
        params: Params,
        response: {
          200: ReverseGeocodeResponse,
          401: ErrorResponseRef,
          403: ErrorResponseRef,
          404: ErrorResponseRef,
          409: ErrorResponseRef,
          502: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      if (!scope.permissions.has(PinpointPermission.LocationsLocationGeocode)) {
        return sendUseCaseError(
          reply,
          UseCaseError.authorization(
            'PERMISSION_DENIED',
            `Missing permission ${PinpointPermission.LocationsLocationGeocode}.`,
          ),
        );
      }
      const location = await findClientLocation(appContext, request.params as ParamsT);
      if (!location) return reply.code(404).send({ error: 'NotFound', message: 'Location not found.' });
      if (location.latitude === null || location.longitude === null) {
        return reply.code(409).send({
          error: 'BusinessRuleViolation',
          code: 'NO_COORDINATES',
          message: 'Location has no coordinates to reverse geocode.',
        });
      }
      try {
        const result = await appContext.services.photon.reverseGeocode(
          location.latitude,
          location.longitude,
        );
        return reply.code(200).send({
          ...result.address,
          formattedAddress: result.formattedAddress,
          confidence: result.confidence,
        });
      } catch (err) {
        return reply
          .code(502)
          .send({ error: 'BadGateway', message: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  fastify.get(
    `${base}/processing-log`,
    {
      schema: {
        operationId: surface.operationId('getLocationProcessingLog'),
        tags,
        params: Params,
        response: { 200: Type.Array(TrailEntry), 401: ErrorResponseRef, 404: ErrorResponseRef },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const location = await findClientLocation(appContext, request.params as ParamsT);
      if (!location) return reply.code(404).send({ error: 'NotFound', message: 'Location not found.' });
      const entries = await appContext.repositories.processingLog.list({ locationId: location.id });
      return reply.code(200).send(
        entries.map((e) => ({
          id: e.id,
          step: e.step,
          data: e.data,
          createdAt: e.createdAt.toISOString(),
        })),
      );
    },
  );

  // Bulk: re-match features for every VALIDATED location of the client.
  fastify.post(
    `${surface.basePath}/clients/:clientId/locations/match-features`,
    {
      schema: {
        operationId: surface.operationId('matchLocationFeaturesBulk'),
        tags,
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        response: {
          200: Type.Object({
            locationsProcessed: Type.Integer({ minimum: 0 }),
            failed: Type.Integer({ minimum: 0 }),
          }),
          401: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      let processed = 0;
      let failed = 0;
      for (let offset = 0; ; offset += 200) {
        const page = await appContext.repositories.locations.listByClient({
          clientId: asClientId(clientId),
          status: 'VALIDATED',
          limit: 200,
          offset,
        });
        for (const l of page.locations) {
          const r = await appContext.runWrite(() =>
            uc.matchLocationFeatures.execute({ clientId, locationId: l.id }),
          );
          if (isFailure(r)) failed += 1;
          else processed += 1;
        }
        if (page.locations.length < 200) break;
      }
      return reply.code(200).send({ locationsProcessed: processed, failed });
    },
  );

  // Cross-client review queue.
  fastify.get(
    `${surface.basePath}/locations/review-queue`,
    {
      schema: {
        operationId: surface.operationId('listLocationReviewQueue'),
        tags,
        summary: 'Locations waiting for review: PENDING, GEOCODED (not auto-approved), capture disagreements.',
        querystring: ReviewQuery,
        response: {
          200: Type.Object({
            locations: Type.Array(LocationDetailSchema),
            total: Type.Integer({ minimum: 0 }),
            limit: Type.Integer(),
            offset: Type.Integer(),
          }),
          401: ErrorResponseRef,
          403: ErrorResponseRef,
        },
      },
    },
    async (request, reply) => {
      const access = await authorizePartitionAccess(
        reply,
        appContext,
        PinpointPermission.LocationsLocationRead,
      );
      if (!access) return reply;
      const q = request.query as {
        clientIds?: string;
        partitionIds?: string;
        reason?: 'PENDING' | 'GEOCODED' | 'CAPTURE_DISAGREES';
        limit?: number;
        offset?: number;
      };
      const list = (v?: string) =>
        v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;
      const page = await appContext.repositories.locations.listReviewQueue({
        visibleTo: access.all ? null : { partitionIds: access.partitionIds, clientIds: access.clientIds },
        clientIds: list(q.clientIds)?.map(asClientId),
        partitionIds: list(q.partitionIds)?.map(asPartitionId),
        reason: q.reason,
        limit,
        offset,
      });
      return reply.code(200).send({
        locations: page.locations.map((l) => toLocationDetail(l, [])),
        total: page.total,
        limit,
        offset,
      });
    },
  );
}

async function findClientLocation(
  appContext: AppContext,
  params: ParamsT,
): Promise<Location | null> {
  const location = await appContext.repositories.locations.findById(asLocationId(params.locationId));
  return location && location.clientId === params.clientId ? location : null;
}
