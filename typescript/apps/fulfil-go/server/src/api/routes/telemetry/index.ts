import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@fulfil-go/framework';
import {
  TelemetryBatchSchema,
  type TelemetryBatch,
  type TelemetryLocation,
} from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import type { NewTelemetryLocation } from '../../../infrastructure/schema/telemetry-locations.js';
import { UnauthorizedSchema, ValidationIssuesSchema } from '../../schemas/common.js';

function toRow(principalId: string, loc: TelemetryLocation): NewTelemetryLocation | null {
  const recordedAt = new Date(loc.timestamp);
  if (Number.isNaN(recordedAt.getTime())) return null;
  return {
    principalId,
    uuid: loc.uuid,
    recordedAt,
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy ?? null,
    speed: loc.coords.speed ?? null,
    heading: loc.coords.heading ?? null,
    altitude: loc.coords.altitude ?? null,
    isMoving: loc.is_moving ?? null,
    activityType: loc.activity?.type ?? null,
    battery: loc.battery ?? null,
    raw: loc,
  };
}

/**
 * POST /telemetry/locations — ingest endpoint for the Transistorsoft NATIVE
 * HTTP uploader (`Config.url`). The plugin posts `{ location: {...} }` per
 * fix, or `{ location: [...] }` with `batchSync: true`, authenticated with
 * the same bearer token as the app (its `authorization` config handles
 * refresh natively). 2xx tells the uploader to delete its on-device SQLite
 * records; any other status makes it retry.
 */
export function registerTelemetryRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.post(
    '/telemetry/locations',
    {
      schema: {
        tags: ['Telemetry'],
        body: TelemetryBatchSchema,
        response: {
          200: Type.Object({ success: Type.Boolean(), inserted: Type.Number() }),
          400: ValidationIssuesSchema,
          401: UnauthorizedSchema,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const body = request.body as TelemetryBatch;
      const locations = Array.isArray(body.location) ? body.location : [body.location];
      const rows: NewTelemetryLocation[] = [];
      for (const loc of locations) {
        const row = toRow(scope.principalId, loc);
        if (!row) {
          return reply.code(400).send({
            error: 'ValidationError',
            issues: [{ message: `unparseable timestamp '${loc.timestamp}' (uuid ${loc.uuid})` }],
          });
        }
        rows.push(row);
      }

      const inserted = await appContext.repositories.telemetry.insertBatch(rows);

      // Vehicle-map read model: latest fix per driver (executionSystem
      // 'own'). Batches arrive oldest-first; the repo's latest-wins guard
      // makes order irrelevant anyway. clientId is null until the
      // execution app binds to a tenant (planning-context work).
      const newest = rows.reduce((a, b) => (a.recordedAt >= b.recordedAt ? a : b));
      await appContext.repositories.transportPositions.upsertLatest({
        clientId: null,
        executionSystem: 'own',
        vehicleRef: scope.principalId,
        lat: newest.latitude,
        lng: newest.longitude,
        heading: newest.heading ?? null,
        speed: newest.speed ?? null,
        recordedAt: newest.recordedAt,
      });

      return reply.code(200).send({ success: true, inserted });
    },
  );
}
