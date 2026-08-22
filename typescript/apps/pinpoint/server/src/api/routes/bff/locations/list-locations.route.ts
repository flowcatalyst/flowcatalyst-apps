/**
 * BFF location list. Mirror of Rust `routes/bff/locations.rs::list_locations`.
 *
 * Pagination via `page` + `pageSize` query (Rust default: page=0, pageSize=100).
 * Returns the UI-shaped subset: id, name, raw address bits, status,
 * masterLocationId, matchConfidence, createdAt. Full Location detail is
 * available on the get endpoint.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import { asClientId, asPartitionId } from '../../../../domain/tenancy/ids.js';
import type { AppContext } from '../../../../app-context.js';

const LocationSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
  partitionId: Type.Union([Type.String(), Type.Null()]),
  address: Type.String(),
  city: Type.String(),
  country: Type.String(),
  status: Type.String(),
  masterLocationId: Type.Union([Type.String(), Type.Null()]),
  matchConfidence: Type.Union([Type.Number(), Type.Null()]),
  /** How the master was matched: EXACT_HASH | FUZZY | null (no match). */
  matchMethod: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});

const ResponseSchema = Type.Object({
  items: Type.Array(LocationSchema),
  total: Type.Integer({ minimum: 0 }),
});

const QuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 0 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  /** Narrow to one partition. */
  partitionId: Type.Optional(Type.String({ minLength: 1 })),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerBffListLocationsRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.get(
    '/bff/clients/:clientId/locations',
    {
      schema: {
        operationId: 'bffListLocations',
        tags: ['BFF'],
        params: Type.Object({ clientId: Type.String({ minLength: 1 }) }),
        querystring: QuerySchema,
        response: { 200: ResponseSchema, 401: ErrorSchema, 500: ErrorSchema },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { clientId } = request.params as { clientId: string };
      const {
        page = 0,
        pageSize = 100,
        partitionId,
      } = request.query as {
        page?: number;
        pageSize?: number;
        partitionId?: string;
      };

      const { locations, total } = await appContext.repositories.locations.listByClient({
        clientId: asClientId(clientId),
        ...(partitionId ? { partitionId: asPartitionId(partitionId) } : {}),
        limit: pageSize,
        offset: page * pageSize,
      });

      return reply.code(200).send({
        items: locations.map((l) => ({
          id: l.id,
          name: l.name,
          partitionId: l.partitionId,
          address: l.rawAddressLine1,
          city: l.rawCity,
          country: l.rawCountry,
          status: l.status,
          masterLocationId: l.masterLocationId,
          matchConfidence: l.matchConfidence,
          matchMethod: l.matchMethod,
          createdAt: l.createdAt.toISOString(),
        })),
        total,
      });
    },
  );
}
